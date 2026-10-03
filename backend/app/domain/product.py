"""Catalog: Category, Product, ChoiceGroup, ChoiceOption, ProductChoiceGroup.

BUSINESS-RULES §2 (R2.2–R2.4), §4 (R4.1). Choice options' ingredient effects are
⚠ OPEN (Q-ING-2) and are not modelled.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum

from .errors import InvalidChoiceSelection, ValidationError
from .money import Money
from .tax import TaxClass


def _require_text(value: str, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{field_name} is required")
    return value.strip()


CODE_PREFIX_PATTERN = re.compile(r"^[A-Z][A-Z0-9]{1,4}$")
PRODUCT_CODE_PATTERN = re.compile(r"^[A-Z0-9](?:[A-Z0-9-]{0,38}[A-Z0-9])?$")
PRODUCT_CODE_MIN_DIGITS = 3


def normalize_code_prefix(value: str) -> str:
    """Category code prefix: 2–5 characters, a letter then letters/digits, stored uppercase."""
    prefix = _require_text(value, "code prefix").upper()
    if not CODE_PREFIX_PATTERN.match(prefix):
        raise ValidationError("code prefix must be 2–5 letters or digits, starting with a letter (e.g. COF)")
    return prefix


def normalize_product_code(value: str) -> str:
    """Product codes are uppercase letters, digits and inner dashes (≤ 40 chars)."""
    code = _require_text(value, "product code").upper()
    if not PRODUCT_CODE_PATTERN.match(code):
        raise ValidationError("product code may only contain letters, digits and dashes (max 40)")
    return code


def generate_product_code(prefix: str, number: int) -> str:
    """``PREFIX-NNN``: zero-padded to at least 3 digits (1 → COF-001, 1000 → COF-1000)."""
    if number < 1:
        raise ValidationError("product code number must be ≥ 1")
    return f"{normalize_code_prefix(prefix)}-{number:0{PRODUCT_CODE_MIN_DIGITS}d}"


@dataclass(slots=True)
class Category:
    """``code_prefix`` is fixed at creation and feeds generated product codes; renaming the
    category never changes it (or any product code)."""

    id: str
    name: str
    code_prefix: str
    sort_order: int = 0
    active: bool = True

    def __post_init__(self) -> None:
        self.name = _require_text(self.name, "category name")
        self.code_prefix = normalize_code_prefix(self.code_prefix)


class SelectionType(StrEnum):
    SINGLE = "single"
    MULTI = "multi"


@dataclass(frozen=True, slots=True)
class ChoiceOption:
    id: str
    group_id: str
    name: str
    price_delta: Money
    is_default: bool = False
    active: bool = True
    sort_order: int = 0

    def __post_init__(self) -> None:
        object.__setattr__(self, "name", _require_text(self.name, "option name"))
        self.price_delta.require_non_negative("price_delta")


@dataclass(slots=True)
class ChoiceGroup:
    """Reusable customization group (Size, Milk…) linked to products via ProductChoiceGroup."""

    id: str
    code: str
    name: str
    selection_type: SelectionType
    required: bool
    min_select: int
    max_select: int
    options: tuple[ChoiceOption, ...] = ()
    display_name: str = ""
    description: str = ""
    active: bool = True

    def __post_init__(self) -> None:
        self.name = _require_text(self.name, "group name")
        if self.min_select < 0 or self.max_select < 1:
            raise ValidationError("min_select must be ≥ 0 and max_select ≥ 1")
        if self.min_select > self.max_select:
            raise ValidationError("min_select must be ≤ max_select")
        if self.selection_type is SelectionType.SINGLE and (self.max_select != 1 or self.min_select > 1):
            raise ValidationError("single-select groups allow at most one option")
        ids = [o.id for o in self.options]
        if len(ids) != len(set(ids)):
            raise ValidationError("duplicate option ids in group")
        if any(o.group_id != self.id for o in self.options):
            raise ValidationError("option belongs to a different group")

    @property
    def label(self) -> str:
        return self.display_name or self.name

    def validate_selection(self, option_ids: Sequence[str]) -> tuple[ChoiceOption, ...]:
        """Validate selected option ids against R2.3; returns the selected options in order."""
        if len(option_ids) != len(set(option_ids)):
            raise InvalidChoiceSelection(f"{self.name}: an option was selected twice")
        by_id = {o.id: o for o in self.options}
        selected: list[ChoiceOption] = []
        for option_id in option_ids:
            option = by_id.get(option_id)
            if option is None:
                raise InvalidChoiceSelection(f"{self.name}: option {option_id} is not in this group")
            if not option.active:
                raise InvalidChoiceSelection(f"{self.name}: option {option.name} is inactive")
            selected.append(option)
        if selected and not self.active:
            raise InvalidChoiceSelection(f"{self.name}: group is inactive")
        count = len(selected)
        if self.selection_type is SelectionType.SINGLE:
            allowed = (1, 1) if self.required else (0, 1)
        else:
            low = max(1, self.min_select) if self.required else self.min_select
            allowed = (low, self.max_select)
        if not allowed[0] <= count <= allowed[1]:
            raise InvalidChoiceSelection(
                f"{self.name}: {count} selected, allowed {allowed[0]}..{allowed[1]}"
            )
        return tuple(selected)


@dataclass(frozen=True, slots=True)
class ProductChoiceGroup:
    """Link between a product and a reusable choice group."""

    product_id: str
    group_id: str
    sort_order: int = 0


@dataclass(slots=True)
class Product:
    """A sellable item.

    ``track_units`` → unit stock; ``track_ingredients`` → recipe consumption. Either,
    both or neither (Q-INV-1); when both, both must be sufficient. ``tax_class`` has no
    default because the default for new products is not decided.
    """

    id: str
    code: str
    name: str
    category_id: str
    price: Money
    tax_class: TaxClass
    description: str = ""
    image_ref: str | None = None
    available: bool = True
    active: bool = True
    track_units: bool = False
    track_ingredients: bool = False
    choice_groups: tuple[ProductChoiceGroup, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        self.code = normalize_product_code(self.code)
        self.name = _require_text(self.name, "product name")
        self.price.require_non_negative("price")
        if any(link.product_id != self.id for link in self.choice_groups):
            raise ValidationError("choice-group link belongs to another product")

    @property
    def is_sellable(self) -> bool:
        return self.active and self.available

    @property
    def tracks_stock(self) -> bool:
        return self.track_units or self.track_ingredients

    @property
    def linked_group_ids(self) -> tuple[str, ...]:
        return tuple(link.group_id for link in sorted(self.choice_groups, key=lambda l: l.sort_order))

    def resolve_selections(
        self,
        groups: Mapping[str, ChoiceGroup],
        selections: Mapping[str, Sequence[str]],
    ) -> tuple[tuple[ChoiceGroup, ChoiceOption], ...]:
        """Validate selections for every linked group (R2.2/R2.3).

        ``selections`` maps group id → selected option ids. Groups not linked to the
        product cannot be used; unselected linked groups count as zero selections.
        """
        linked = self.linked_group_ids
        unknown = set(selections) - set(linked)
        if unknown:
            raise InvalidChoiceSelection(f"groups not linked to {self.name}: {sorted(unknown)}")
        result: list[tuple[ChoiceGroup, ChoiceOption]] = []
        for group_id in linked:
            group = groups.get(group_id)
            if group is None:
                raise ValidationError(f"choice group {group_id} not provided")
            for option in group.validate_selection(list(selections.get(group_id, ()))):
                result.append((group, option))
        return tuple(result)
