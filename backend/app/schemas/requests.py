"""Request DTOs at the API boundary (shape validation only; business rules live in the domain).
Money travels as decimal strings, never floats."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, StrictInt


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")

    def payload(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)


class LoginRequest(_Model):
    username: str = Field(min_length=1, max_length=40)
    credential: str = Field(min_length=1, max_length=200)


class ChangeCredentialRequest(_Model):
    current: str = Field(min_length=1, max_length=200)
    new: str = Field(min_length=1, max_length=200)


class SetupCompleteRequest(_Model):
    business: dict[str, Any]
    admin: dict[str, Any]
    security: dict[str, Any]
    settings: dict[str, dict[str, Any]] | None = None
    first_terminal: dict[str, Any] | None = None


class TerminalActivateRequest(_Model):
    terminal_code: str = Field(min_length=1, max_length=20)
    activation_code: str = Field(min_length=1, max_length=40)


class OrderLine(_Model):
    product_id: str
    quantity: StrictInt  # true/1.0 are not quantities
    selections: dict[str, list[str]] | None = None


class OrderDiscountIn(_Model):
    discount_id: str
    identification: dict[str, str] | None = None


class CreateOrderRequest(_Model):
    order_type: str
    lines: list[OrderLine]
    discount: OrderDiscountIn | None = None
    tag: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=500)
    # The total the cashier saw (from /orders/quote); a mismatch at creation → 409 CART_STALE.
    expected_total: str | None = Field(default=None, max_length=20)


class StatusRequest(_Model):
    target: str
    expected_version: StrictInt | None = None


class CancelRequest(_Model):
    reason: str = Field(max_length=200)
    expected_version: StrictInt | None = None


class PaymentRequestIn(_Model):
    method: str
    amount: str
    tendered: str | None = None
    reference: str | None = Field(default=None, max_length=60)


class RefundRequest(_Model):
    kind: str
    reason: str = Field(max_length=200)
    amount: str | None = Field(default=None, max_length=20)  # partial refunds only


class SettingsUpdate(_Model):
    version: StrictInt
    data: dict[str, Any]


class ArchiveRequest(_Model):
    order_ids: list[str]
    reason: str = Field(min_length=1, max_length=200)
