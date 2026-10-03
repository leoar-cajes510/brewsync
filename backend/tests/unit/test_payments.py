import unittest
from decimal import Decimal

from domain_support import T0, m, make_order, product
from app.domain.errors import (
    DuplicateOperation, ImmutableRecordError, InsufficientTender, InvalidPayment, Overpayment,
    PaymentMethodNotEnabled, ReferenceRequired, ValidationError,
)
from app.domain.order import OrderItem, PaymentStatus
from app.domain.payment import (
    CashRoundingMode, CashRoundingPolicy, MethodOptions, PaymentMethod, PaymentRecordStatus, PaymentRequest,
    PaymentSettings, build_payment,
)

CASH, GCASH, CARD = PaymentMethod.CASH, PaymentMethod.GCASH, PaymentMethod.CARD


def settings(*, rounding=None, confirm=False, require_cash_received=True, enabled=None):
    return PaymentSettings(
        enabled_methods=frozenset(enabled or {CASH, GCASH, CARD, PaymentMethod.BANK_TRANSFER}),
        options={CASH: MethodOptions(require_cash_received=require_cash_received),
                 GCASH: MethodOptions(require_reference=True, require_confirmation=confirm),
                 CARD: MethodOptions(require_reference=False)},
        cash_rounding=rounding or CashRoundingPolicy(enabled=False),
    )


def pay(order, request, cfg, n):
    payment = build_payment(request, remaining_balance=order.remaining_balance, settings=cfg,
                            payment_id=f"pay-{n}", order_id=order.id, idempotency_key=f"key-{n}",
                            terminal_id="t-1", user_id="u-1", at=T0)
    return payment, order.add_payment(payment)


class SplitPaymentTests(unittest.TestCase):
    def test_cash_300_plus_gcash_200_settles_500(self):
        order = make_order()  # 2 × 250.00 = 500.00, tax disabled
        cfg = settings()
        cash, paid = pay(order, PaymentRequest(CASH, m("300.00"), tendered=m("500.00")), cfg, 1)
        self.assertEqual((cash.change_given, paid, order.payment_status), (m("200.00"), False, PaymentStatus.PARTIALLY_PAID))
        self.assertEqual(order.remaining_balance, m("200.00"))
        _, paid = pay(order, PaymentRequest(GCASH, m("200.00"), reference=" GC-778812 "), cfg, 2)
        self.assertTrue(paid)
        self.assertEqual(order.payment_status, PaymentStatus.PAID)
        self.assertEqual(order.payments[1].reference, "GC-778812")

    def test_overpayment_and_tender_and_reference_rules(self):
        order = make_order()
        cfg = settings()
        with self.assertRaises(Overpayment):
            pay(order, PaymentRequest(CASH, m("500.01"), tendered=m("600.00")), cfg, 1)
        with self.assertRaises(InsufficientTender):
            pay(order, PaymentRequest(CASH, m("100.00"), tendered=m("50.00")), cfg, 1)
        with self.assertRaises(InvalidPayment):
            pay(order, PaymentRequest(CASH, m("100.00")), cfg, 1)  # cash received required
        with self.assertRaises(ReferenceRequired):
            pay(order, PaymentRequest(GCASH, m("100.00")), cfg, 1)
        with self.assertRaises(ReferenceRequired):
            pay(order, PaymentRequest(CARD, m("100.00"), reference="12"), cfg, 1)
        with self.assertRaises(PaymentMethodNotEnabled):
            pay(order, PaymentRequest(GCASH, m("100.00"), reference="GC-1234"), settings(enabled={CASH}), 1)
        self.assertEqual(order.payment_status, PaymentStatus.UNPAID)

    def test_offline_is_cash_only(self):
        order = make_order()
        with self.assertRaises(PaymentMethodNotEnabled):
            pay(order, PaymentRequest(GCASH, m("500.00"), reference="GC-1234", offline=True), settings(), 1)
        payment, paid = pay(order, PaymentRequest(CASH, m("500.00"), tendered=m("500.00"), offline=True), settings(), 2)
        self.assertTrue(paid and payment.origin.value == "offline")

    def test_pending_payments_block_overpayment_and_count_only_when_confirmed(self):
        order = make_order()
        cfg = settings(confirm=True)
        gcash, paid = pay(order, PaymentRequest(GCASH, m("500.00"), reference="GC-1234"), cfg, 1)
        self.assertEqual((gcash.status, paid, order.payment_status), (PaymentRecordStatus.PENDING, False, PaymentStatus.UNPAID))
        with self.assertRaises(Overpayment):
            pay(order, PaymentRequest(CASH, m("1.00"), tendered=m("1.00")), cfg, 2)
        self.assertTrue(order.confirm_payment("pay-1", "u-admin", T0))
        self.assertEqual(order.payment_status, PaymentStatus.PAID)

    def test_completed_payments_are_immutable_and_idempotent(self):
        order = make_order()
        payment, _ = pay(order, PaymentRequest(CASH, m("100.00"), tendered=m("100.00")), settings(), 1)
        with self.assertRaises(ImmutableRecordError):
            payment.void()
        with self.assertRaises(Exception):
            payment.amount = m("1.00")  # type: ignore[misc]
        with self.assertRaises(DuplicateOperation):
            order.add_payment(payment)  # retry with the same idempotency key

    def test_pending_payment_can_be_voided(self):
        order = make_order()
        pay(order, PaymentRequest(GCASH, m("200.00"), reference="GC-1234"), settings(confirm=True), 1)
        order.void_payment("pay-1")
        self.assertEqual(order.payments[0].status, PaymentRecordStatus.VOIDED)
        self.assertEqual(order.remaining_balance, m("500.00"))


class CashRoundingTests(unittest.TestCase):
    def odd_order(self):
        return make_order([OrderItem.from_product("i-1", product(price="500.37"), (), 1)])

    def test_disabled_rounding_uses_exact_amount(self):
        order = self.odd_order()
        payment, paid = pay(order, PaymentRequest(CASH, m("500.37"), tendered=m("501.00")), settings(), 1)
        self.assertEqual((payment.amount, payment.rounding_adjustment, payment.change_given, paid),
                         (m("500.37"), m("0.00"), m("0.63"), True))

    def test_nearest_and_up_rounding_settle_with_explicit_adjustment(self):
        nearest = CashRoundingPolicy(True, Decimal("0.25"), CashRoundingMode.NEAREST)
        order = self.odd_order()
        payment, paid = pay(order, PaymentRequest(CASH, m("500.37"), tendered=m("501.00")), settings(rounding=nearest), 1)
        self.assertEqual((payment.amount, payment.rounding_adjustment, payment.change_given), (m("500.25"), m("0.12"), m("0.75")))
        self.assertTrue(paid)
        self.assertEqual(order.totals.total, m("500.37"))  # total never changed

        up = CashRoundingPolicy(True, Decimal("0.25"), CashRoundingMode.UP)
        order = self.odd_order()
        payment, paid = pay(order, PaymentRequest(CASH, m("500.37"), tendered=m("500.50")), settings(rounding=up), 1)
        self.assertEqual((payment.amount, payment.rounding_adjustment, paid), (m("500.50"), m("-0.13"), True))

    def test_rounding_not_applied_to_partial_or_non_cash_payments(self):
        nearest = CashRoundingPolicy(True, Decimal("1.00"), CashRoundingMode.NEAREST)
        order = self.odd_order()
        partial, _ = pay(order, PaymentRequest(CASH, m("300.00"), tendered=m("300.00")), settings(rounding=nearest), 1)
        self.assertEqual(partial.rounding_adjustment, m("0.00"))
        card, paid = pay(order, PaymentRequest(CARD, m("200.37")), settings(rounding=nearest), 2)
        self.assertEqual((card.amount, paid), (m("200.37"), True))

    def test_enabled_rounding_needs_configuration(self):
        with self.assertRaises(ValidationError):
            CashRoundingPolicy(True)
        with self.assertRaises(ValidationError):
            CashRoundingPolicy(True, Decimal("0.001"), CashRoundingMode.DOWN)


if __name__ == "__main__":
    unittest.main()
