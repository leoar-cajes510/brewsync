"""Repository/mapping checks against the real database (Checkpoint B/C)."""

import unittest

from db_support import SCHEMA, DbTestCase


class SchemaTests(DbTestCase):
    def test_migration_created_all_tables_and_constraints(self):
        tables = self.scalar("select count(*) from information_schema.tables where table_schema=:s", s=SCHEMA)
        self.assertEqual(tables, 41)  # 40 + alembic_version
        self.assertEqual(self.scalar("select version_num from {s}.alembic_version"), "0003_choice_option_effects")
        checks = self.scalar("select count(*) from information_schema.check_constraints c join "
                             "information_schema.table_constraints t on t.constraint_name=c.constraint_name "
                             "where t.table_schema=:s and t.constraint_type='CHECK' and t.table_name='stock_levels'",
                             s=SCHEMA)
        self.assertGreaterEqual(checks, 5)

    def test_database_rejects_negative_stock_directly(self):
        env = self.bootstrap()
        self.catalog(env["admin"])
        with self.assertRaises(Exception):
            self.execute("update {s}.stock_levels set reserved = on_hand + 1")
        with self.assertRaises(Exception):
            self.execute("update {s}.stock_levels set on_hand = -1")

    def test_order_round_trips_through_repository(self):
        from app.database.session import unit_of_work
        from app.repositories.order_repository import OrderRepository
        env = self.bootstrap()
        ids = self.catalog(env["admin"])
        o = self.order(env["admin"], [{"product_id": ids["latte"], "quantity": 1},
                                      {"product_id": ids["cookie"], "quantity": 2}]).json()
        self.pay(env["admin"], o["id"], {"method": "cash", "amount": "100.00", "tendered": "100.00"})
        import uuid
        with unit_of_work(self.factory) as session:
            _, order = OrderRepository(session).load(uuid.UUID(o["id"]), "PHP")
            self.assertEqual(order.totals.total.amount, 450)
            self.assertEqual(len(order.items), 2)
            self.assertEqual(order.payment_status.value, "partially_paid")
            self.assertEqual(str(order.remaining_balance.amount), "350.00")
            self.assertEqual(len(order.reservation.quantities), 1)


if __name__ == "__main__":
    unittest.main()
