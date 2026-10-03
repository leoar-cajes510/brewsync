import unittest

from domain_support import T0, m, make_order
from app.domain.errors import (
    DuplicateOperation, FeatureDisabled, RefundExceedsPayment, RefundNotAllowed, UndecidedPolicy, ValidationError,
)
from app.domain.order import RefundStatus
from app.domain.payment import (
    CashRoundingPolicy, MethodOptions, PaymentMethod, PaymentRequest, PaymentSettings, build_payment,
)
from app.domain.refund import Refund, RefundAllocation, RefundKind, RefundLine

CASH, GCASH = PaymentMethod.CASH, PaymentMethod.GCASH
CFG = PaymentSettings(frozenset({CASH, GCASH}), {GCASH: MethodOptions(require_reference=True)}, CashRoundingPolicy(False))


def completed_split_order():
    order = make_order()  # 500.00 = 2 items × 250.00 (one line, quantity 2)
    for n, req in enumerate([PaymentRequest(CASH, m("300.00"), tendered=m("300.00")),
                             PaymentRequest(GCASH, m("200.00"), reference="GC-1234")], start=1):
        order.add_payment(build_payment(req, remaining_balance=order.remaining_balance, settings=CFG,
                                        payment_id=f"pay-{n}", order_id=order.id, idempotency_key=f"k-{n}",
                                        terminal_id="t-1", user_id="u-1", at=T0))
    order.complete(T0)
    return order


def refund(order, amount, allocations, *, kind=RefundKind.PARTIAL, key="r-1", lines=(), restocked=False):
    return Refund(id=key, order_id=order.id, kind=kind, amount=m(amount), reason="Spilled drink",
                  allocations=tuple(RefundAllocation(pid, m(a), meth) for pid, a, meth in allocations),
                  user_id="u-admin", terminal_id="t-1", idempotency_key=key, created_at=T0, lines=lines,
                  restocked=restocked)


class RefundTests(unittest.TestCase):
    def test_full_refund_returns_every_completed_payment(self):
        order = completed_split_order()
        allocations = order.full_refund_allocations()
        self.assertEqual(allocations, (("pay-1", m("300.00")), ("pay-2", m("200.00"))))
        status = order.add_refund(refund(order, "500.00", [("pay-1", "300.00", CASH), ("pay-2", "200.00", GCASH)],
                                         kind=RefundKind.FULL), refunds_enabled=True)
        self.assertEqual((status, order.refundable_amount), (RefundStatus.REFUNDED, m("0.00")))
        self.assertEqual(len(order.payments), 2)  # originals untouched
        self.assertEqual(order.payment_status.value, "paid")

    def test_partial_refunds_up_to_the_completed_payments(self):
        order = completed_split_order()
        order.add_refund(refund(order, "250.00", [("pay-1", "250.00", CASH)],
                                lines=(RefundLine(order.items[0].id, 1),)), refunds_enabled=True)
        self.assertEqual((order.refund_status, order.refundable_amount), (RefundStatus.PARTIALLY_REFUNDED, m("250.00")))
        with self.assertRaises(RefundExceedsPayment):  # cash payment has only 50.00 left
            order.add_refund(refund(order, "100.00", [("pay-1", "100.00", CASH)], key="r-2"), refunds_enabled=True)
        with self.assertRaises(RefundExceedsPayment):  # total cap
            order.add_refund(refund(order, "250.01", [("pay-1", "50.00", CASH), ("pay-2", "200.01", GCASH)], key="r-3"),
                             refunds_enabled=True)
        with self.assertRaises(RefundExceedsPayment):  # quantity 2 − 1 refunded = 1 left
            order.add_refund(refund(order, "10.00", [("pay-2", "10.00", GCASH)], key="r-4",
                                    lines=(RefundLine(order.items[0].id, 2),)), refunds_enabled=True)

    def test_full_refund_must_cover_the_refundable_amount(self):
        order = completed_split_order()
        with self.assertRaises(ValidationError):
            order.add_refund(refund(order, "300.00", [("pay-1", "300.00", CASH)], kind=RefundKind.FULL),
                             refunds_enabled=True)

    def test_toggle_completion_and_idempotency(self):
        order = completed_split_order()
        r = refund(order, "10.00", [("pay-1", "10.00", CASH)])
        with self.assertRaises(FeatureDisabled):
            order.add_refund(r, refunds_enabled=False)
        order.add_refund(r, refunds_enabled=True)
        with self.assertRaises(DuplicateOperation):
            order.add_refund(r, refunds_enabled=True)
        with self.assertRaises(RefundNotAllowed):
            fresh = make_order(oid="o-2")
            fresh.add_refund(refund(fresh, "1.00", [("pay-1", "1.00", CASH)]), refunds_enabled=True)

    def test_refund_record_rules_and_open_questions(self):
        order = completed_split_order()
        with self.assertRaises(ValidationError):  # allocations must sum to amount
            refund(order, "50.00", [("pay-1", "40.00", CASH)])
        with self.assertRaises(ValidationError):  # reason required
            Refund(id="r", order_id=order.id, kind=RefundKind.PARTIAL, amount=m("1.00"), reason=" ",
                   allocations=(RefundAllocation("pay-1", m("1.00"), CASH),), user_id="u", terminal_id="t",
                   idempotency_key="k", created_at=T0)
        with self.assertRaises(UndecidedPolicy) as ctx:
            refund(order, "10.00", [("pay-1", "10.00", CASH)], restocked=True)
        self.assertEqual(ctx.exception.question_id, "Q-REF-3")
        with self.assertRaises(ValidationError):  # allocation method must match the payment
            order.add_refund(refund(order, "10.00", [("pay-1", "10.00", GCASH)]), refunds_enabled=True)


if __name__ == "__main__":
    unittest.main()
