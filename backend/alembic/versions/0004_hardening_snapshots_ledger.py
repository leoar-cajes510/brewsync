"""Historical cost snapshots and richer stock ledger (hardening release).

Additive only — every new column is NULLABLE and nothing is backfilled, so existing orders and
movements are untouched (old orders simply have no snapshot and are reported as estimated).

- ``order_items.cost_snapshot`` (JSONB): per-unit ingredient consumption and the ingredient unit
  cost in force when the order was created, so later cost/recipe changes never rewrite margins.
- ``order_items.category_name``: the product category name at sale time (history/analytics).
- ``stock_movements.supplier``: who the stock was received from (purchase receiving).
- ``stock_movements.counted_quantity`` / ``system_quantity``: physical count vs system on_hand
  recorded with a count correction (the variance is the movement's delta).

Revision ID: 0004_hardening_snapshots_ledger
Revises: 0003_choice_option_effects
Create Date: 2026-10-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_hardening_snapshots_ledger"
down_revision = "0003_choice_option_effects"
branch_labels = None
depends_on = None


def _schema() -> str | None:
    """Target schema (see 0002): ALTER DDL does not apply env.py's schema_translate_map."""
    return op.get_context().version_table_schema


def upgrade() -> None:
    schema = _schema()
    op.add_column("order_items", sa.Column("cost_snapshot", postgresql.JSONB(), nullable=True), schema=schema)
    op.add_column("order_items", sa.Column("category_name", sa.String(length=80), nullable=True), schema=schema)
    op.add_column("stock_movements", sa.Column("supplier", sa.String(length=120), nullable=True), schema=schema)
    op.add_column("stock_movements", sa.Column("counted_quantity", sa.Numeric(precision=12, scale=3), nullable=True), schema=schema)
    op.add_column("stock_movements", sa.Column("system_quantity", sa.Numeric(precision=12, scale=3), nullable=True), schema=schema)


def downgrade() -> None:
    schema = _schema()
    op.drop_column("stock_movements", "system_quantity", schema=schema)
    op.drop_column("stock_movements", "counted_quantity", schema=schema)
    op.drop_column("stock_movements", "supplier", schema=schema)
    op.drop_column("order_items", "category_name", schema=schema)
    op.drop_column("order_items", "cost_snapshot", schema=schema)
