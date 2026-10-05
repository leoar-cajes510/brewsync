"""Catalog & stock tables (DATABASE.md §Catalog & stock)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean, CheckConstraint, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, Uuid,
)
from sqlalchemy import text as text_
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, JSONType, money, quantity, text, ts, uuid_pk

BIZ = "businesses.id"


class CategoryRow(Base):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("business_id", "name"), UniqueConstraint("business_id", "code_prefix"))
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    name: Mapped[str] = text(80)
    code_prefix: Mapped[str] = text(5)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ProductRow(Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("business_id", "code"),
        CheckConstraint("price >= 0", name="price"),
        CheckConstraint("tax_class in ('taxable','non_taxable')", name="tax_class"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    code: Mapped[str] = text(40)
    name: Mapped[str] = text(120)
    description: Mapped[str] = mapped_column(Text, default="")
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"))
    price: Mapped[Decimal] = money()
    image_url: Mapped[str | None] = text(500, nullable=True)
    available: Mapped[bool] = mapped_column(Boolean, default=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    track_units: Mapped[bool] = mapped_column(Boolean, default=False)
    track_ingredients: Mapped[bool] = mapped_column(Boolean, default=False)
    tax_class: Mapped[str] = text(20)
    deleted_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = ts(default_now=True)
    updated_at: Mapped[datetime] = ts(default_now=True)


class ChoiceGroupRow(Base):
    __tablename__ = "choice_groups"
    __table_args__ = (
        UniqueConstraint("business_id", "code"),
        CheckConstraint("min_select >= 0 and max_select >= 1 and min_select <= max_select", name="min_max"),
        CheckConstraint("selection_type in ('single','multi')", name="selection_type"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    code: Mapped[str] = text(40)
    name: Mapped[str] = text(80)
    display_name: Mapped[str] = text(80)
    description: Mapped[str] = mapped_column(Text, default="")
    selection_type: Mapped[str] = text(10)
    required: Mapped[bool] = mapped_column(Boolean)
    min_select: Mapped[int] = mapped_column(Integer)
    max_select: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ChoiceOptionRow(Base):
    __tablename__ = "choice_options"
    __table_args__ = (CheckConstraint("price_delta >= 0", name="price_delta"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("choice_groups.id", ondelete="RESTRICT"))
    name: Mapped[str] = text(80)
    price_delta: Mapped[Decimal] = money()
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class ProductChoiceGroupRow(Base):
    __tablename__ = "product_choice_groups"
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), primary_key=True)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("choice_groups.id", ondelete="RESTRICT"), primary_key=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class IngredientRow(Base):
    __tablename__ = "ingredients"
    __table_args__ = (
        UniqueConstraint("business_id", "name"),
        UniqueConstraint("business_id", "code"),
        CheckConstraint("unit_cost >= 0", name="unit_cost"),
        CheckConstraint("unit in ('g','kg','ml','L','pcs')", name="unit"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    code: Mapped[str] = text(40)
    name: Mapped[str] = text(120)
    category: Mapped[str] = text(60)
    unit: Mapped[str] = text(5)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(12, 4))
    notes: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class RecipeRow(Base):
    __tablename__ = "recipes"
    id: Mapped[uuid.UUID] = uuid_pk()
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), unique=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    updated_at: Mapped[datetime] = ts(default_now=True)


class RecipeLineRow(Base):
    __tablename__ = "recipe_lines"
    __table_args__ = (UniqueConstraint("recipe_id", "ingredient_id"), CheckConstraint("quantity > 0", name="quantity"))
    id: Mapped[uuid.UUID] = uuid_pk()
    recipe_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("recipes.id", ondelete="CASCADE"))
    ingredient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ingredients.id", ondelete="RESTRICT"))
    quantity: Mapped[Decimal] = quantity()


class ChoiceOptionEffectRow(Base):
    """Ingredient effect of a choice option (R4a.3a). Options are never deleted (only deactivated),
    so the cascade only matters for a hard delete; orders keep their own snapshots and reservation."""

    __tablename__ = "choice_option_effects"
    __table_args__ = (
        UniqueConstraint("option_id", "ingredient_id"),
        Index("uq_choice_option_effects_option_id_replaces_ingredient_id", "option_id", "replaces_ingredient_id",
              unique=True, postgresql_where=text_("replaces_ingredient_id is not null")),
        Index("uq_choice_option_effects_option_id_scale", "option_id", unique=True,
              postgresql_where=text_("mode = 'scale'")),
        Index("ix_choice_option_effects_ingredient_id", "ingredient_id"),
        CheckConstraint("quantity > 0", name="quantity"),
        CheckConstraint("(mode = 'scale' and ingredient_id is null and replaces_ingredient_id is null) or "
                        "(mode = 'add' and ingredient_id is not null and replaces_ingredient_id is null) or "
                        "(mode = 'replace' and ingredient_id is not null and replaces_ingredient_id is not null "
                        "and replaces_ingredient_id <> ingredient_id)", name="mode"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    option_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("choice_options.id", ondelete="CASCADE"))
    mode: Mapped[str] = text(10)
    # NULL only for 'scale' (a factor for the whole base recipe; ``quantity`` holds the factor).
    ingredient_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ingredients.id", ondelete="RESTRICT"),
                                                            nullable=True)
    replaces_ingredient_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ingredients.id", ondelete="RESTRICT"), nullable=True)
    quantity: Mapped[Decimal] = quantity()
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class StockLevelRow(Base):
    __tablename__ = "stock_levels"
    __table_args__ = (
        UniqueConstraint("business_id", "subject_type", "subject_id"),
        CheckConstraint("on_hand >= 0", name="on_hand"),
        CheckConstraint("reserved >= 0", name="reserved"),
        CheckConstraint("reserved <= on_hand", name="reserved_le_on_hand"),
        CheckConstraint("low_stock_threshold >= 0", name="threshold"),
        CheckConstraint("subject_type in ('product','ingredient')", name="subject_type"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    subject_type: Mapped[str] = text(12)
    subject_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    on_hand: Mapped[Decimal] = quantity()
    reserved: Mapped[Decimal] = quantity()
    low_stock_threshold: Mapped[Decimal] = quantity()
    initialized: Mapped[bool] = mapped_column(Boolean, default=False)
    last_restocked_at: Mapped[datetime | None] = ts()


class StockMovementRow(Base):
    """Append-only."""

    __tablename__ = "stock_movements"
    __table_args__ = (Index("ix_stock_movements_subject", "subject_type", "subject_id", "created_at"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    subject_type: Mapped[str] = text(12)
    subject_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    type: Mapped[str] = text(24)
    delta_on_hand: Mapped[Decimal] = quantity()
    delta_reserved: Mapped[Decimal] = quantity()
    on_hand_after: Mapped[Decimal] = quantity()
    reserved_after: Mapped[Decimal] = quantity()
    reason: Mapped[str | None] = text(120, nullable=True)
    note: Mapped[str | None] = text(200, nullable=True)
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    reference_type: Mapped[str] = text(24)
    reference_id: Mapped[str | None] = text(64, nullable=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[datetime] = ts(nullable=False)
    supplier: Mapped[str | None] = text(120, nullable=True)
    counted_quantity: Mapped[Decimal | None] = quantity(nullable=True)
    system_quantity: Mapped[Decimal | None] = quantity(nullable=True)


class PosSnapshotRow(Base):
    __tablename__ = "pos_snapshots"
    __table_args__ = (UniqueConstraint("business_id", "catalog_version"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    catalog_version: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSONType)
    created_at: Mapped[datetime] = ts(default_now=True)


class DiscountRow(Base):
    __tablename__ = "discounts"
    __table_args__ = (
        UniqueConstraint("business_id", "name"),
        CheckConstraint("type in ('percentage','fixed')", name="type"),
        CheckConstraint("value > 0", name="value"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    name: Mapped[str] = text(80)
    type: Mapped[str] = text(12)
    value: Mapped[Decimal] = money()
    eligibility: Mapped[str] = text(12)
    custom_eligibility: Mapped[str] = text(60)
    min_order: Mapped[Decimal | None] = money(nullable=True)
    max_discount: Mapped[Decimal | None] = money(nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    requires_identification: Mapped[bool] = mapped_column(Boolean, default=False)
    identification_fields: Mapped[list] = mapped_column(JSONType, default=list)
    created_at: Mapped[datetime] = ts(default_now=True)


_ = String  # keep import for type checkers
