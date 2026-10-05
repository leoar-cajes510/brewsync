"""Category management against the real database: rename, (de)activate and the Admin-only permanent
DELETE /categories/{id} (Q-DEL-1) — allowed only for a category that never held a product or issued a code."""

import dataclasses
import unittest
import uuid

from db_support import DbTestCase

from app.core.exceptions import AppError


class CategoryApiTests(DbTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.env = self.bootstrap()
        self.admin = self.env["admin"]

    def category(self, name: str = "Pastries", prefix: str = "PAS") -> str:
        return self.call("POST", "/categories", self.admin, {"name": name, "code_prefix": prefix}, expect=201).json()["id"]

    def counts(self) -> dict[str, int]:
        tables = ("categories", "products", "orders", "payments", "documents", "stock_levels", "stock_movements",
                  "recipes", "sequences")
        return {t: self.scalar(f"SELECT count(*) FROM {{s}}.{t}") for t in tables}

    def test_admin_deletes_unused_category_and_audits_it(self) -> None:
        ids = self.catalog(self.admin)  # unrelated catalog with products and stock
        unused = self.category()
        before = self.counts()
        r = self.call("DELETE", f"/categories/{unused}", self.admin, expect=200).json()
        self.assertEqual(r, {"id": unused, "deleted": True})
        after = self.counts()
        self.assertEqual(after, {**before, "categories": before["categories"] - 1})
        listed = [c["id"] for c in self.call("GET", "/categories", self.admin, expect=200).json()]
        self.assertNotIn(unused, listed)
        self.assertIn(ids["category"], listed)
        self.assertEqual(self.scalar("SELECT count(*) FROM {s}.audit_logs WHERE action = 'category.deleted' "
                                     "AND before::text LIKE '%PAS%' AND before::text LIKE '%Pastries%'"), 1)
        self.call("DELETE", f"/categories/{unused}", self.admin, expect=404)

    def test_never_used_counter_row_is_removed_with_the_category(self) -> None:
        unused = self.category()
        business = self.scalar("SELECT business_id FROM {s}.categories WHERE id = :id", id=unused)
        self.execute("INSERT INTO {s}.sequences (business_id, name, next_value) VALUES (:b, :n, 1)",
                     b=business, n=f"product:{unused}")
        self.call("DELETE", f"/categories/{unused}", self.admin, expect=200)
        self.assertEqual(self.scalar("SELECT count(*) FROM {s}.sequences WHERE name = :n", n=f"product:{unused}"), 0)

    def test_category_with_products_is_refused(self) -> None:
        ids = self.catalog(self.admin)
        before = self.counts()
        r = self.call("DELETE", f"/categories/{ids['category']}", self.admin, expect=409)
        self.assertEqual(self.error_code(r), "CONFLICT")
        self.assertEqual(r.json()["error"]["message"],
                         "This category has 2 products and cannot be deleted. Move or delete them first.")
        self.assertEqual(self.counts(), before)
        codes = {p["code"] for p in self.call("GET", "/products", self.admin, expect=200).json()}
        self.assertEqual(codes, {"LATTE", "COOKIE"})

    def test_soft_deleted_product_still_blocks_deletion(self) -> None:
        cat = self.category()
        pid = self.call("POST", "/products", self.admin, {"code": "OLD", "name": "Old", "category_id": cat,
                        "price": "10.00", "tax_class": "taxable"}, expect=201).json()["id"]
        self.execute("UPDATE {s}.products SET deleted_at = now() WHERE id = :id", id=pid)
        r = self.call("DELETE", f"/categories/{cat}", self.admin, expect=409)
        self.assertEqual(r.json()["error"]["message"],
                         "This category has 1 product and cannot be deleted. Move or delete them first.")

    def test_category_that_issued_codes_is_refused_even_when_empty(self) -> None:
        cat = self.category()
        pid = self.call("POST", "/products", self.admin, {"name": "Croissant", "category_id": cat, "price": "90.00",
                        "tax_class": "taxable"}, expect=201).json()
        self.assertEqual(pid["code"], "PAS-001")
        self.call("DELETE", f"/products/{pid['id']}", self.admin, expect=200)  # never sold: product deletable
        r = self.call("DELETE", f"/categories/{cat}", self.admin, expect=409)
        self.assertEqual(self.error_code(r), "CONFLICT")
        self.assertEqual(r.json()["error"]["message"], "Product codes were already issued from this category.")
        self.assertEqual(self.scalar("SELECT next_value FROM {s}.sequences WHERE name = :n", n=f"product:{cat}"), 2)
        self.assertEqual(self.scalar("SELECT count(*) FROM {s}.categories WHERE id = :id", id=cat), 1)

    def test_cashier_cannot_delete_even_with_products_delete_granted(self) -> None:
        cat = self.category()
        self.call("PUT", "/settings/permissions", self.admin, {"roles": {"cashier": {"products.delete": True}}},
                  expect=200)
        cashier = self.make_cashier(self.admin, self.env["device"])
        me = self.call("GET", "/auth/me", cashier, expect=200).json()
        self.assertIn("products.delete", str(me))
        r = self.call("DELETE", f"/categories/{cat}", cashier, expect=403)
        self.assertEqual(self.error_code(r), "PERMISSION_DENIED")
        self.assertEqual(self.scalar("SELECT count(*) FROM {s}.categories WHERE id = :id", id=cat), 1)
        self.assertEqual(self.client.delete(f"/api/v1/categories/{cat}").status_code, 401)

    def test_wrong_business_or_unknown_category_is_404(self) -> None:
        cat = self.category()
        self.call("DELETE", f"/categories/{uuid.uuid4()}", self.admin, expect=404)
        from app.services.auth_service import authenticate
        from app.services.product_service import delete_category
        with self.factory() as session:
            actor = authenticate(session, self.admin)
            other = dataclasses.replace(actor, business_id=uuid.uuid4())
            with self.assertRaises(AppError) as ctx:
                delete_category(session, other, cat)
            self.assertEqual(ctx.exception.status, 404)
        self.assertEqual(self.scalar("SELECT count(*) FROM {s}.categories WHERE id = :id", id=cat), 1)

    def test_rename_and_activate_deactivate_unchanged(self) -> None:
        cat = self.category("Coffee", "COF")
        r = self.call("PATCH", f"/categories/{cat}", self.admin, {"name": "Coffee & Espresso"}, expect=200).json()
        self.assertEqual((r["name"], r["code_prefix"]), ("Coffee & Espresso", "COF"))
        self.assertFalse(self.call("PATCH", f"/categories/{cat}", self.admin, {"active": False}, expect=200).json()["active"])
        self.assertTrue(self.call("PATCH", f"/categories/{cat}", self.admin, {"active": True}, expect=200).json()["active"])
        self.call("PATCH", f"/categories/{cat}", self.admin, {"code_prefix": "ESP"}, expect=422)


if __name__ == "__main__":
    unittest.main()
