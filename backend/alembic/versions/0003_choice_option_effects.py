"""Choice-option ingredient effects (Q-ING-2; BUSINESS-RULES R4a.3a).

Additive only: creates ``choice_option_effects``. No existing table or row is changed.

- ``mode`` 'scale' → multiply every base-recipe line by ``quantity`` (the factor, e.g. 1.5 for Large);
  ``ingredient_id`` and ``replaces_ingredient_id`` are NULL; at most one per option.
- ``mode`` 'add' → consume ``quantity`` more of ``ingredient_id`` (``replaces_ingredient_id`` NULL).
- ``mode`` 'replace' → when ``replaces_ingredient_id`` is in the product's base recipe, consume
  ``quantity`` × the selected scale factor of ``ingredient_id`` instead of that line.
- ``option_id`` cascades (options are only ever deactivated; orders keep their own choice snapshots
  and frozen reservation). Ingredient references RESTRICT so a used ingredient cannot be deleted.

Revision ID: 0003_choice_option_effects
Revises: 0002_category_code_prefix
Create Date: 2026-10-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_choice_option_effects"
down_revision = "0002_category_code_prefix"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "choice_option_effects",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("option_id", sa.Uuid(), nullable=False),
        sa.Column("mode", sa.String(length=10), nullable=False),
        sa.Column("ingredient_id", sa.Uuid(), nullable=True),
        sa.Column("replaces_ingredient_id", sa.Uuid(), nullable=True),
        sa.Column("quantity", sa.Numeric(precision=12, scale=3), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.CheckConstraint("quantity > 0", name=op.f("ck_choice_option_effects_quantity")),
        sa.CheckConstraint("(mode = 'scale' and ingredient_id is null and replaces_ingredient_id is null) or "
                           "(mode = 'add' and ingredient_id is not null and replaces_ingredient_id is null) or "
                           "(mode = 'replace' and ingredient_id is not null and replaces_ingredient_id is not null "
                           "and replaces_ingredient_id <> ingredient_id)",
                           name=op.f("ck_choice_option_effects_mode")),
        sa.ForeignKeyConstraint(["option_id"], ["choice_options.id"],
                                name=op.f("fk_choice_option_effects_option_id_choice_options"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ingredient_id"], ["ingredients.id"],
                                name=op.f("fk_choice_option_effects_ingredient_id_ingredients"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["replaces_ingredient_id"], ["ingredients.id"],
                                name=op.f("fk_choice_option_effects_replaces_ingredient_id_ingredients"),
                                ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_choice_option_effects")),
        sa.UniqueConstraint("option_id", "ingredient_id", name=op.f("uq_choice_option_effects_option_id_ingredient_id"))
    )
    op.create_index(op.f("uq_choice_option_effects_option_id_replaces_ingredient_id"), "choice_option_effects",
                    ["option_id", "replaces_ingredient_id"], unique=True,
                    postgresql_where=sa.text("replaces_ingredient_id is not null"))
    op.create_index(op.f("uq_choice_option_effects_option_id_scale"), "choice_option_effects", ["option_id"],
                    unique=True, postgresql_where=sa.text("mode = 'scale'"))
    op.create_index(op.f("ix_choice_option_effects_ingredient_id"), "choice_option_effects", ["ingredient_id"])


def downgrade() -> None:
    op.drop_table("choice_option_effects")
