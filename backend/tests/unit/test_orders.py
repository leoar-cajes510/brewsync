import unittest
from datetime import timedelta

from domain_support import T0, m, make_order, percent_discount, product, tax_settings
from app.domain.archive import ArchiveMethod, ArchivePolicy
from app.domain.errors import (
    InvalidStateTransition, OrderNotSettled, RestoreWindowExpired, UndecidedPolicy, ValidationError, VersionConflict,
)
from app.domain.order import OrderItem, OrderStatus, PaymentStatus, RefundStatus
from app.domain.payment import MethodOptions, PaymentMethod, PaymentRequest, PaymentSettings, CashRoundingPolicy, build_payment

CFG = PaymentSettings(frozenset({PaymentMethod.CASH, PaymentMethod.GCASH}),
                      {PaymentMethod.GCASH: MethodOptions(require_reference=True, require_confirmation=True)},
                      CashRoundingPolicy(False))


def pay_cash(order, amount, n=1):
    p = build_payment(PaymentRequest(PaymentMethod.CASH, m(amount), tendered=m(amount)),
                      remaining_balance=order.remaining_balance, settings=CFG, payment_id=f"pay-{n}",
                      order_id=order.id, idempotency_key=f"k-{n}", terminal_id="t-1", user_id="u-1", at=T0)
    return order.add_payment(p)


class LifecycleTests(unittest.TestCase):
    def test_new_order_is_pending_and_unpaid(self):
        order = make_order()
        self.assertEqual((order.status, order.payment_status, order.refund_status, order.version),
                         (OrderStatus.PENDING, PaymentStatus.UNPAID, RefundStatus.NONE, 1))

    def test_order_first_pay_later_flow(self):
        order = make_order()
        order.advance(OrderStatus.PREPARING, T0, expected_version=1)
        order.advance(OrderStatus.READY, T0 + timedelta(minutes=5))
        with self.assertRaises(OrderNotSettled):
            order.complete(T0 + timedelta(minutes=6))
        self.assertTrue(pay_cash(order, "500.00"))
        plan = order.complete(T0 + timedelta(minutes=7))
        self.assertIs(plan, order.reservation)  # service converts it to sale movements
        self.assertEqual(order.status, OrderStatus.COMPLETED)

    def test_invalid_transitions_and_final_states(self):
        order = make_order()
        with self.assertRaises(InvalidStateTransition):
            order.advance(OrderStatus.PENDING, T0)
        order.advance(OrderStatus.READY, T0)  # permitted forward skip
        with self.assertRaises(InvalidStateTransition):
            order.advance(OrderStatus.PREPARING, T0)
        pay_cash(order, "500.00")
        order.complete(T0)
        for action in (lambda: order.complete(T0), lambda: order.cancel("oops", T0),
                       lambda: order.undo_last_step(T0), lambda: order.advance(OrderStatus.READY, T0)):
            with self.assertRaises(InvalidStateTransition):
                action()

    def test_undo_last_step(self):
        order = make_order()
        order.advance(OrderStatus.PREPARING, T0)
        order.advance(OrderStatus.READY, T0)
        order.undo_last_step(T0)
        self.assertEqual((order.status, order.ready_at), (OrderStatus.PREPARING, None))

    def test_stale_version_rejected(self):
        order = make_order()
        order.advance(OrderStatus.PREPARING, T0, expected_version=1)
        with self.assertRaises(VersionConflict):
            order.advance(OrderStatus.READY, T0, expected_version=1)

    def test_completed_payments_cannot_be_added_after_completion(self):
        order = make_order()
        pay_cash(order, "500.00")
        order.complete(T0)
        late = build_payment(PaymentRequest(PaymentMethod.CASH, m("1.00"), tendered=m("1.00")),
                             remaining_balance=m("1.00"), settings=CFG, payment_id="pay-2", order_id=order.id,
                             idempotency_key="k-2", terminal_id="t-1", user_id="u-1", at=T0)
        with self.assertRaises(InvalidStateTransition):
            order.add_payment(late)


class CancellationTests(unittest.TestCase):
    def test_unpaid_order_cancel_returns_reservation_and_voids_pending(self):
        order = make_order()
        p = build_payment(PaymentRequest(PaymentMethod.GCASH, m("500.00"), reference="GC-1234"),
                          remaining_balance=order.remaining_balance, settings=CFG, payment_id="pay-1",
                          order_id=order.id, idempotency_key="k-1", terminal_id="t-1", user_id="u-1", at=T0)
        order.add_payment(p)
        plan = order.cancel("Customer left", T0)
        self.assertIs(plan, order.reservation)
        self.assertEqual((order.status, order.payments[0].status.value), (OrderStatus.CANCELLED, "voided"))
        with self.assertRaises(InvalidStateTransition):
            order.cancel("again", T0)

    def test_cancel_requires_reason(self):
        with self.assertRaises(ValidationError):
            make_order().cancel("  ", T0)

    def test_cancelling_paid_order_is_open_question(self):
        order = make_order()
        pay_cash(order, "100.00")
        with self.assertRaises(UndecidedPolicy) as ctx:
            order.cancel("changed mind", T0)
        self.assertEqual(ctx.exception.question_id, "Q-CAN-1")
        self.assertEqual(order.status, OrderStatus.PENDING)


class TotalsSnapshotTests(unittest.TestCase):
    def test_frozen_totals_and_discount_allocation(self):
        items = [OrderItem.from_product("i-1", product("p-1", price="300.00"), (), 1),
                 OrderItem.from_product("i-2", product("p-2", price="100.00"), (), 1)]
        order = make_order(items, tax=tax_settings("10"), discount=percent_discount("10"))
        t = order.totals
        self.assertEqual((t.subtotal, t.discount_total, t.net_amount, t.tax_amount, t.total),
                         (m("400.00"), m("40.00"), m("360.00"), m("36.00"), m("396.00")))
        self.assertEqual([i.discount_allocation for i in order.items], [m("30.00"), m("10.00")])
        self.assertEqual(order.discount.amount, m("40.00"))

    def test_editing_after_placement_is_open(self):
        with self.assertRaises(UndecidedPolicy):
            make_order().edit_items()


class ArchiveTests(unittest.TestCase):
    POLICY = ArchivePolicy(auto_archive_after=timedelta(days=1), restore_window=timedelta(hours=48))

    def completed(self):
        order = make_order()
        pay_cash(order, "500.00")
        order.complete(T0)
        return order

    def test_completed_orders_auto_archive_after_configured_timing(self):
        order = self.completed()
        self.assertFalse(order.is_auto_archive_eligible(T0 + timedelta(hours=23), self.POLICY))
        order.archive(T0 + timedelta(days=1), ArchiveMethod.AUTO, by="ignored", policy=self.POLICY)
        self.assertEqual((order.archive_method, order.archived_by), (ArchiveMethod.AUTO, None))

    def test_cancelled_orders_are_never_auto_archived_only_manually(self):
        order = make_order()
        order.cancel("Wrong item", T0)
        self.assertFalse(order.is_auto_archive_eligible(T0 + timedelta(days=30), self.POLICY))
        with self.assertRaises(InvalidStateTransition):
            order.archive(T0 + timedelta(days=30), ArchiveMethod.AUTO, by=None, policy=self.POLICY)
        with self.assertRaises(ValidationError):
            order.archive(T0, ArchiveMethod.MANUAL, by="u-admin")  # reason required
        order.archive(T0, ArchiveMethod.MANUAL, by="u-admin", reason="Reviewed")
        self.assertTrue(order.is_archived)

    def test_active_orders_cannot_be_archived(self):
        with self.assertRaises(InvalidStateTransition):
            make_order().archive(T0, ArchiveMethod.MANUAL, by="u-admin", reason="x")

    def test_restore_window_and_no_auto_rearchive(self):
        order = self.completed()
        order.archive(T0, ArchiveMethod.MANUAL, by="u-admin", reason="early")
        with self.assertRaises(RestoreWindowExpired):
            order.restore(T0 + timedelta(hours=49), by="u-admin", policy=self.POLICY)
        order.restore(T0 + timedelta(hours=47), by="u-admin", policy=self.POLICY)
        self.assertFalse(order.is_archived)
        self.assertFalse(order.is_auto_archive_eligible(T0 + timedelta(days=10), self.POLICY))


if __name__ == "__main__":
    unittest.main()
