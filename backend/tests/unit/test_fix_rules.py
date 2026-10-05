"""Service rules added by the functional-audit fixes (mocked repositories; no database)."""
import unittest
import uuid
from types import SimpleNamespace
from unittest import mock

from app.core.exceptions import AppError
from app.core.security import hash_credential
from app.domain.identity import AuthMethod, RoleKey
from app.services import auth_service, inventory_service, product_service, terminal_service


def actor(**kw):
    base = dict(user_id=uuid.uuid4(), business_id=uuid.uuid4(), currency="PHP", role=RoleKey.ADMIN,
                terminal_id=None, require=lambda *k: None, require_terminal=lambda: uuid.uuid4())
    base.update(kw)
    return SimpleNamespace(**base)


class LoginPrivacyTests(unittest.TestCase):
    """AUTH-04: the response never reveals whether a username exists."""

    def run_login(self, *, interim, terminal, user_row, credential="right-password-1"):
        staff = mock.Mock()
        staff.user_by_username.return_value = user_row
        staff.to_domain_user.side_effect = lambda row: SimpleNamespace(
            role=row.role, auth_method=AuthMethod.PASSWORD, ensure_can_sign_in=lambda *a: None,
            record_failed_sign_in=lambda *a: False, record_successful_sign_in=lambda: None)
        system = mock.Mock(business=mock.Mock(return_value=SimpleNamespace(id="b1")))
        patches = [
            mock.patch.object(auth_service, "require_completed"),
            mock.patch.object(auth_service, "SystemRepository", return_value=system),
            mock.patch.object(auth_service, "StaffRepository", return_value=staff),
            mock.patch.object(auth_service, "resolve_terminal", return_value=terminal),
            mock.patch.object(auth_service, "get_settings",
                              return_value=SimpleNamespace(interim_admin_login_without_terminal=interim)),
            mock.patch.object(auth_service, "section", return_value={}),
            mock.patch.object(auth_service, "security_settings", return_value=(None, None, {})),
            mock.patch.object(auth_service, "audit"),
            mock.patch.object(auth_service, "emit"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        with self.assertRaises(AppError) as ctx:
            auth_service.login(mock.Mock(), "someone", credential, None)
        return ctx.exception.status, ctx.exception.code, ctx.exception.message

    def row(self, role):
        return SimpleNamespace(id="u1", role=role, password_hash=hash_credential("right-password-1"), pin_hash=None)

    def test_no_terminal_default_mode_is_identical_for_known_and_unknown_users(self):
        known = self.run_login(interim=False, terminal=None, user_row=self.row(RoleKey.ADMIN), credential="wrong-pass")
        unknown = self.run_login(interim=False, terminal=None, user_row=None, credential="wrong-pass")
        self.assertEqual(known, unknown)
        self.assertEqual(known[:2], (403, "TERMINAL_NOT_ACTIVATED"))

    def test_interim_flag_wrong_password_and_unknown_user_identical_401(self):
        wrong = self.run_login(interim=True, terminal=None, user_row=self.row(RoleKey.CASHIER), credential="wrong-pass")
        unknown = self.run_login(interim=True, terminal=None, user_row=None, credential="wrong-pass")
        self.assertEqual(wrong, unknown)
        self.assertEqual(wrong[:2], (401, "UNAUTHENTICATED"))

    def test_interim_flag_correct_cashier_without_terminal_gets_403(self):
        status, code, _ = self.run_login(interim=True, terminal=None, user_row=self.row(RoleKey.CASHIER))
        self.assertEqual((status, code), (403, "TERMINAL_NOT_ACTIVATED"))


class CategoryNameTests(unittest.TestCase):
    """CAT-04: category names are unique per business ignoring case."""

    def test_case_insensitive_duplicate_rejected(self):
        session = mock.Mock()
        session.scalar.return_value = uuid.uuid4()  # an existing "Coffee"
        with self.assertRaises(AppError) as ctx:
            product_service._ensure_unique_category_name(session, actor(), "coffee")
        self.assertEqual((ctx.exception.status, ctx.exception.code), (409, "CONFLICT"))

    def test_unique_name_accepted(self):
        session = mock.Mock()
        session.scalar.return_value = None
        product_service._ensure_unique_category_name(session, actor(), "Pastries")


class DeleteProductTests(unittest.TestCase):
    """PRD-12 / Q-DEL-1: hard delete only if never sold, reserved or moved."""

    def setUp(self):
        p = mock.patch.object(product_service, "audit")
        p.start()
        self.addCleanup(p.stop)
        p2 = mock.patch.object(product_service, "SystemRepository")
        p2.start()
        self.addCleanup(p2.stop)

    def session(self, a, *, used):
        s = mock.Mock()
        s.get.return_value = SimpleNamespace(business_id=a.business_id, code="TEA-009", name="Test")
        s.scalar.side_effect = [used, False, False]  # sold?, moved?, held?
        return s

    def test_used_product_refused_and_not_deleted(self):
        a = actor()
        s = self.session(a, used=True)
        with self.assertRaises(AppError) as ctx:
            product_service.delete_product(s, a, str(uuid.uuid4()))
        self.assertEqual((ctx.exception.status, ctx.exception.code), (409, "CONFLICT"))
        s.delete.assert_not_called()

    def test_unused_product_deleted(self):
        a = actor()
        s = self.session(a, used=False)
        self.assertTrue(product_service.delete_product(s, a, str(uuid.uuid4()))["deleted"])
        s.delete.assert_called_once()


class RecipeDeductionTests(unittest.TestCase):
    """ING-15: recipe consumption needs at least one line; an empty recipe switches it off."""

    def setUp(self):
        self.product = SimpleNamespace(business_id=None, track_ingredients=True)
        repo = mock.Mock(product=mock.Mock(return_value=self.product), recipes=mock.Mock(return_value={}))
        for target, value in (("ProductRepository", mock.Mock(return_value=repo)), ("SystemRepository", mock.Mock()),
                              ("audit", mock.Mock())):
            p = mock.patch.object(inventory_service, target, value)
            p.start()
            self.addCleanup(p.stop)

    def test_deduction_without_lines_rejected(self):
        a = actor()
        self.product.business_id = a.business_id
        with self.assertRaises(AppError) as ctx:
            inventory_service.set_recipe(mock.Mock(), a, str(uuid.uuid4()), [], track_ingredients=True)
        self.assertEqual(ctx.exception.status, 422)

    def test_empty_recipe_turns_deduction_off(self):
        a = actor()
        self.product.business_id = a.business_id
        result = inventory_service.set_recipe(mock.Mock(), a, str(uuid.uuid4()), [])
        self.assertFalse(result["track_ingredients"])
        self.assertFalse(self.product.track_ingredients)


class TerminalSelfLockoutTests(unittest.TestCase):
    """TRM-10: an Admin cannot deactivate the terminal their own session runs on."""

    def test_own_terminal_refused(self):
        tid = uuid.uuid4()
        a = actor(terminal_id=tid)
        staff = mock.Mock(terminal=mock.Mock(return_value=SimpleNamespace(id=tid, business_id=a.business_id)))
        with mock.patch.object(terminal_service, "StaffRepository", return_value=staff), \
                mock.patch.object(terminal_service, "SystemRepository"):
            with self.assertRaises(AppError) as ctx:
                terminal_service.deactivate(mock.Mock(), a, tid)
        self.assertEqual((ctx.exception.status, ctx.exception.code), (409, "INVALID_TRANSITION"))


class DiscountUpdateTests(unittest.TestCase):
    """SET-DSC-04: PATCH keeps unsent fields and validates the merged discount."""

    def setUp(self):
        for target in ("SystemRepository", "audit"):
            p = mock.patch.object(product_service, target)
            p.start()
            self.addCleanup(p.stop)
        p = mock.patch.object(product_service, "feature_on", return_value=True)
        p.start()
        self.addCleanup(p.stop)

    def row(self, a):
        from decimal import Decimal
        return SimpleNamespace(id=uuid.uuid4(), business_id=a.business_id, name="Promo", type="percentage",
                               value=Decimal("10"), eligibility="all", custom_eligibility="", min_order=None,
                               max_discount=None, active=True, requires_identification=False, identification_fields=[])

    def test_partial_update_keeps_other_fields(self):
        a = actor()
        r = self.row(a)
        s = mock.Mock(get=mock.Mock(return_value=r))
        out = product_service.update_discount(s, a, str(r.id), {"value": "15"})
        self.assertEqual((out["name"], out["value"], out["active"]), ("Promo", "15", True))

    def test_invalid_value_rejected(self):
        a = actor()
        r = self.row(a)
        s = mock.Mock(get=mock.Mock(return_value=r))
        with self.assertRaises(AppError):
            product_service.update_discount(s, a, str(r.id), {"value": "150"})


if __name__ == "__main__":
    unittest.main()
