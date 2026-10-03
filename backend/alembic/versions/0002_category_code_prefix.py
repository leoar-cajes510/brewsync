"""Category code prefix for generated product codes (PREFIX-NNN).

- Adds ``categories.code_prefix`` (uppercase, unique per business, fixed after creation).
- Backfills existing categories: "Coffee" → ``COF``; any other category gets a prefix derived
  once from its name (made unique per business). Products, order snapshots and documents are
  NOT touched — existing product codes (e.g. the legacy ``AMERICANO``) stay exactly as they are.
- Widens ``sequences.name`` to 64 so the per-category counter key ``product:<uuid>`` fits.

Revision ID: 0002_category_code_prefix
Revises: 0001_initial
Create Date: 2026-09-30
"""
import re

from alembic import op
import sqlalchemy as sa

revision = "0002_category_code_prefix"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

KNOWN = {"coffee": "COF"}


def _derive(name: str, taken: set[str]) -> str:
    base = (KNOWN.get(name.strip().lower()) or re.sub(r"[^A-Z0-9]", "", name.upper()).lstrip("0123456789")[:3])
    base = base if len(base) >= 2 else "CAT"
    prefix, n = base, 2
    while prefix in taken:
        prefix, n = f"{base[:3]}{n}", n + 1
    return prefix


def _schema() -> str | None:
    """The target schema (env.py: DB_SCHEMA or ``-x schema=``). Passed explicitly because Alembic's
    ALTER DDL and ``op.get_bind()`` do not apply env.py's schema_translate_map."""
    return op.get_context().version_table_schema


def upgrade() -> None:
    schema = _schema()
    op.alter_column("sequences", "name", existing_type=sa.String(length=40), type_=sa.String(length=64),
                    existing_nullable=False, schema=schema)
    op.add_column("categories", sa.Column("code_prefix", sa.String(length=5), nullable=True),
                  schema=schema)

    conn = op.get_bind()
    categories = sa.table("categories", sa.column("id", sa.Uuid()), sa.column("business_id", sa.Uuid()),
                          sa.column("name", sa.String()), sa.column("code_prefix", sa.String()), schema=schema)
    rows = conn.execute(sa.select(categories.c.id, categories.c.business_id, categories.c.name)
                        .order_by(categories.c.business_id, categories.c.name)).all()
    taken: dict[object, set[str]] = {}
    # Known names first so "Coffee" always gets COF.
    for row in sorted(rows, key=lambda r: r.name.strip().lower() not in KNOWN):
        used = taken.setdefault(row.business_id, set())
        prefix = _derive(row.name, used)
        used.add(prefix)
        conn.execute(sa.update(categories).where(categories.c.id == row.id).values(code_prefix=prefix))

    op.alter_column("categories", "code_prefix", existing_type=sa.String(length=5), nullable=False,
                    schema=schema)
    op.create_unique_constraint(op.f("uq_categories_business_id_code_prefix"), "categories",
                                ["business_id", "code_prefix"], schema=schema)


def downgrade() -> None:
    schema = _schema()
    op.drop_constraint(op.f("uq_categories_business_id_code_prefix"), "categories", type_="unique", schema=schema)
    op.drop_column("categories", "code_prefix", schema=schema)
    op.alter_column("sequences", "name", existing_type=sa.String(length=64), type_=sa.String(length=40),
                    existing_nullable=False, schema=schema)
