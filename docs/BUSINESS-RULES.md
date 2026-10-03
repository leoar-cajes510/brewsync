# BrewSync — Business Rules

> **Status: Phase 3B (2026-09-27) — business rules finalized for implementation. Documentation only; nothing here is implemented.**
>
> - All rules are enforced by the **backend only**. The frontend may pre-validate and render optimistic state for UX, but the server result is authoritative (R0.11).
> - Decision status (DECIDED / OPEN, dates, options, consequences) lives in **[DECISIONS.md](DECISIONS.md)** — the single source of truth. Rules for OPEN items are marked **⚠ OPEN (Q-ID)** and must not be implemented beyond any labelled *Interim safe behaviour — not a decision* until decided.
> - Companion documents: [SYSTEM-LOGIC.md](SYSTEM-LOGIC.md) · [USER-FLOWS.md](USER-FLOWS.md) · [PERMISSIONS.md](PERMISSIONS.md) · [DATABASE.md](DATABASE.md) · [API.md](API.md).
> - Nothing in this document is a legal statement. No BIR or other legal compliance is claimed. Every legal/compliance dependency is marked ⚖ with its verification item (VR-1…VR-8, §23).
>
> Markers: **★** high priority · **⚖** requires legal/business verification before production · **⚠ OPEN** not decided · **✱** permission · **⚑** feature gate.
> Rule numbers `R<section>.<n>` are stable within this document; other documents cite this file by section (e.g. "BUSINESS-RULES §7").

---

## 0. Global conventions

- **R0.1 Money** is decimal with exactly 2 decimal places; currency from Settings → Business. Never floating point. One monetary representation throughout the backend (SR-8).
- **R0.2 Rounding policy (Q-TAX-3, DECIDED).** One server-side rounding policy in the Money module: **half-up to 0.01**, applied **only** at these defined points:

  | Rounding point | Rule |
  |---|---|
  | Line total | unit price × quantity (R2.4) |
  | Discount amount and its allocation | R5.4; allocation by largest remainder so it sums exactly (R6.3) |
  | Tax | once per order per tax class (R6.3) |
  | Order total | R6.3 |
  | Change | R7.6 |
  | Refund amount | R10.5 |
  | Cash rounding | remaining balance rounded to the configured `increment` by the configured `mode` (not the half-up 0.01 policy); values are configuration (R7.7) ⚖ VR-5 |

  The client never rounds authoritative values. If a prescribed calculation/rounding method is verified to apply, it replaces this policy in one place (the Money module). ⚖ VR-4
- **R0.3 Quantities:** product quantities are positive integers. Ingredient quantities are decimals with up to 3 dp. Ingredient unit costs have up to 4 dp.
- **R0.4 Time:** stored in UTC; "today", day boundaries, auto-archive timing and reports use the Business timezone. Device-reported times from offline terminals (`captured_at`) are stored but not trusted; `received_at` is server time (§19, AR-5).
- **R0.5 Snapshots:** anything printed or reported historically (product/option names and prices, discount, identification details where required, tax name/rate/mode/amounts, cashier, terminal, business header, document formatting) is copied onto the order / sales document at the moment it happens. Later catalog or settings changes never alter it.
- **R0.6 Immutability:** the following are never updated or deleted; corrections are new rows:

  | Record | Immutable from |
  |---|---|
  | `payments` | once `completed` (pending → completed / voided are the only transitions) |
  | `refunds`, `refund_lines`, `refund_allocations` | creation |
  | `documents` (snapshot and number) | issue — only `documents.status` and `print_count` change (R8.8, R8.7) |
  | `document_prints` | creation |
  | `stock_movements` | creation |
  | `audit_logs` | creation |
  | `settings_history` | creation |
  | `offline_submissions` (raw payload) | receipt — processing status, attempts and resolution are recorded alongside; the original submission is never modified |

- **R0.7 Single transaction:** every use case that touches several tables runs in **one** database transaction — order creation (incl. reservation), payment recording/confirmation (incl. document issue), status change, completion (incl. sale movements), cancellation (incl. reservation release), refund, restock/adjust, reprint, archive/restore, setup completion, offline commit. Partial writes are impossible. Real-time events are written to the outbox (`domain_events`) in the same transaction and published after commit (§20).
- **R0.8 Scoping:** every query and write is filtered by `business_id`.
- **R0.9 Idempotency:** an `Idempotency-Key` header is **required** on: `POST /orders`, `POST /orders/{id}/payments`, `POST /orders/{id}/refunds`, `POST /orders/{id}/cancel`, `POST /orders/{id}/status` (target `completed`), and inventory/ingredient restock & adjust. The server stores (`idempotency_records`: key, scope, request_hash, response) the outcome in the same transaction. Repeating the same request with the same key returns the stored outcome and never creates a second order, payment, refund, movement or status change. Reusing a key with a different request → **422 IDEMPOTENCY_KEY_REUSED**. Offline submissions use `client_txn_id` instead (§19).
- **R0.10 Feature gating:** a disabled feature (Settings → Features) makes the module's write endpoints return **403 FEATURE_DISABLED** (⚑ markers below). Existing data is preserved. Stock behaviour while a tracking feature is disabled is **⚠ OPEN (Q-FEAT-1)**; Admin read access to disabled-feature data is **⚠ OPEN (Q-FEAT-2)**.
- **R0.11 Server authority (SR-2, SR-8):** the server/database is authoritative. The server never trusts client-sent totals, prices, stock quantities, discounts, taxes, permissions or payment status; it recomputes subtotal, discount, tax, total, amount due, change, refund amount and rounding from stored/configured data before committing. Client-entered payment amount and tendered cash are *requests* validated against server-computed balances. A client may render optimistic state; on rejection it reverts and shows the server's reason.
- **R0.12 Errors** use the canonical codes listed in API.md (e.g. 409 INSUFFICIENT_STOCK, 409 VERSION_CONFLICT, 422 VALIDATION_ERROR).

---

## 1. Order lifecycle

| `orders.status` | UI label | Active board | Terminal state |
|---|---|:-:|:-:|
| `pending` | Pending | ✔ | |
| `preparing` | Preparing | ✔ | |
| `ready` | Ready for Pickup | ✔ | |
| `completed` | Completed | (History) | ✔ |
| `cancelled` | Cancelled | (Admin review list) | ✔ |

Archive is a flag (`archived_at`), **not** a status (§12).

- **R1.1 Separate dimensions.** Preparation status (`orders.status`), payment (`orders.payment_status`: `unpaid` · `partially_paid` · `paid`, server-derived per R7.5) and refunds (`orders.refund_status`: `none` · `partially_refunded` · `refunded`, R10.11) are three independent fields. Unpaid orders are valid active orders (Q-ORD-1).
- **R1.2 Canonical flow (Q-ORD-1, DECIDED):** POS → Order Created → Pending → Preparing → Ready for Pickup → Payment → Completed. Payment is normally collected at Ready for Pickup, but may be recorded at any point while the order is `pending`, `preparing` or `ready` (R7.3). Whether the POS also offers "pay now" at order creation is **⚠ OPEN (Q-ORD-6)** (UI flow only; the rules here already allow it).
- **R1.3 Version.** `orders.version` (int) increments on every change to the order (status, payment status, refund status, archive flag). State-changing requests carry `expected_version`; a mismatch → **409 VERSION_CONFLICT**. A transition not allowed by the table below → **409 INVALID_TRANSITION**. The order row is locked for every transition (§20).

### Transitions

| From | To | Allowed when | Permission | Side effects |
|---|---|---|---|---|
| — | `pending` | Order creation succeeds (§2), stock reserved (§4) | ✱pos.createOrders (+ ✱pos.applyDiscounts if a discount) | Order number assigned (R1.8); totals frozen; `reservation` movements; `payment_status = unpaid`; `order.created` event |
| `pending` | `preparing` | — | ✱orders.changeStatus | `started_at`; `order.status_changed` |
| `preparing` | `ready` | — | ✱orders.changeStatus | `ready_at`; optional notification; `order.status_changed` |
| `ready` | `completed` | `payment_status = paid` (else **409 ORDER_NOT_SETTLED**) | ✱orders.complete | §11: reservations → `sale` movements; `completed_at`; appears in History; eligible for automatic archive; `order.completed` |
| `pending` → `ready`; `pending`/`preparing` → `completed` (forward skip) | — | Actor holds the target permission; completion **always** requires `paid` | ✱orders.changeStatus / ✱orders.complete | Skipped timestamps set to the same instant |
| `preparing` → `pending`; `ready` → `preparing` (undo last step) | — | Within the same shift | ✱orders.changeStatus | Timestamps of the undone step cleared; audited; reservations unchanged |
| `pending` / `preparing` / `ready` | `cancelled` | Reason required; §9 | ✱pos.cancelOrders (protected) | Reservations released; pending payments voided; `cancelled_at`; `order.cancelled` |
| `completed` | anything | **Never** (money returned only via refund, §10) | — | — |
| `cancelled` | anything | **Never** | — | — |

- **R1.4 Forward skips** are allowed (e.g. grab-and-go `pending → completed`) when the actor holds the target permission; the skipped timestamps are set to the same instant. Completion always requires `payment_status = paid` (R11.1).
- **R1.5 Overdue.** An order in `pending` or `preparing` for longer than Staffing → *Order Waiting Threshold* minutes is flagged `overdue` (computed, not stored) and, if Features → Order Alerts and Preferences → Order Waiting Alerts are on (precedence ⚠ OPEN Q-SET-2), triggers `alert.order_overdue` once.
- **R1.6 Unpaid orders hold stock.** No automatic cancellation of stale unpaid orders is decided; they hold their reservations until completed or cancelled (risk AR-10, SYSTEM-LOGIC §14).
- **R1.7 Editing after placement ⚠ OPEN (Q-ORD-2).** *Interim safe behaviour — not a decision:* items, quantities, options and the discount are read-only once the order exists; `PATCH /orders/{id}` (✱pos.editOrders) is not implemented until decided. Changing the order means cancel (§9) and re-create.
- **R1.8 Order number** = next value of the business order sequence (`sequences`), zero-padded (e.g. `1045`), assigned inside the creation transaction. Gaps caused by rolled-back transactions are acceptable. The order number is operational and **separate** from the sales document number (§8, C-14). An order captured offline carries a device-generated provisional reference (`offline_ref`) until it is committed at sync, when it receives its canonical number (§19); `orders.origin` = `online` / `offline`.
- **R1.9 Per-type status steps ⚠ OPEN (Q-ORD-3).** *Interim safe behaviour — not a decision:* all order types use the one flow above.

---

## 2. Order creation (POS)

- **R2.1 Server recomputes.** The cart is client-side until `POST /orders`. The server recomputes everything from product IDs, option IDs, quantities and the chosen discount ID; client prices and totals are ignored (R0.11). `POST /orders/quote` returns the same server-computed totals for preview without creating anything or reserving stock.
- **R2.2 Line validation.** Each line's product must be `active` and `available`; every selected option must be `active` and belong to a choice group linked to that product.
- **R2.3 Choice validation per group:** `single` → exactly 1 if required, 0..1 if optional; `multi` → count between `min` and `max`; required multi groups need ≥ max(1, `min`). Option IDs are unique within a line.
- **R2.4 Unit price** = product base price + Σ selected option `price_delta`. **Line total** = unit price × quantity (rounded per R0.2).
- **R2.5 Identical lines** (same product + same option set) are merged by summing quantities.
- **R2.6 Stock reservation** per §4, all-or-nothing, in the creation transaction. Any shortfall → **409 INSUFFICIENT_STOCK** listing the offending products/ingredients; nothing is created.
- **R2.7 Order type & tag.** Order type must be one of the enabled types; default from Preferences → Default Order Type. Whether a table number / delivery reference (`tag`) is required is **⚠ OPEN (Q-ORD-4)** — *Interim safe behaviour — not a decision:* `tag` optional for every type. Keeping a customer name/record on orders is **⚠ OPEN (Q-ORD-5)** ⚖ VR-7.
- **R2.8 Empty cart** → **400 EMPTY_CART**.
- **R2.9 Pricing pipeline:** line totals → subtotal → the one discount (§5) → pro-rata allocation → tax (§6) → total. Totals are frozen on the order. Payment is a separate step (§7).
- **R2.10 No payment needed (Q-ORD-1).** An order is created with `payment_status = unpaid`. Payment is recorded separately (✱pos.processPayments, §7), at creation time (if the POS offers pay-now, Q-ORD-6) or later.
- **R2.11 Idempotency-Key** is required on `POST /orders` (R0.9).
- **R2.12 Discount identification capture.** If the chosen discount has `requires_identification`, the request must include the configured `identification_fields`; missing → **422 IDENTIFICATION_REQUIRED** (R5.7).
- **R2.13 Attribution.** Terminal, session and cashier are taken from the authenticated session (never from the request body) and recorded on the order.
- **R2.14 One transaction:** order + items + item choices + discount snapshot + frozen totals + order number + `reservation` movements + audit (discount application) + `order.created` outbox event.

---

## 3. Inventory (stock levels & movements)

- **R3.1 Stock levels.** Every stock subject has one `stock_levels` row (`subject_type` product / ingredient, `subject_id`) with `on_hand`, `reserved`, `low_stock_threshold`, `last_restocked_at`. **`available = on_hand − reserved`** (computed). A product gets a row when `track_units` is first enabled; the row is kept (never deleted) if the flag is later turned off, so existing reservations can still be released or finalized (R4.5); ingredients always have one. (Replaces `product_stock` and `ingredients.stock_quantity`.)
- **R3.2 Movements only.** Stock changes only through `stock_movements` rows, each recording `delta_on_hand`, `delta_reserved`, the resulting balances, `reference_type` (`order` / `refund` / `offline_submission` / `manual`) + reference id, reason, note, unit cost (restock), actor.

| Movement type | Δ on_hand | Δ reserved | Written by |
|---|:-:|:-:|---|
| `initial` | +q | 0 | Product/ingredient creation (R3.5) |
| `restock` | +q | 0 | Inventory / Ingredients restock |
| `adjustment` | ±q | 0 | Manual adjustment, reason Damaged / Lost / Other |
| `correction` | ±q | 0 | Count correction |
| `waste` | −q | 0 | Waste |
| `reservation` | 0 | +q | Order creation (§4) |
| `reservation_release` | 0 | −q | Cancellation before completion (§9) |
| `sale` | −q | −q | Completion — reservation becomes the sale (§11) |
| `sale_reversal` | +q | 0 | Refund with restock, only if Q-REF-3 decides so (§10) |

- **R3.3 Balances recorded:** `on_hand_after = previous on_hand + delta_on_hand` and `reserved_after = previous reserved + delta_reserved` on every movement.
- **R3.4 Manual movements.** Restock quantity > 0 (unit cost optional, ≥ 0); adjustment/correction delta ≠ 0 and requires a reason; waste quantity > 0; note optional ≤ 200 chars. Idempotency-Key required (R0.9). Not available offline (§19).
- **R3.5 Initial stock** is set once at creation (movement `initial`); later changes go through Inventory / Ingredients, never via product or ingredient edit.
- **R3.6 Negative stock is never allowed (Q-INV-3, DECIDED).** Invariants: `on_hand ≥ 0`, `reserved ≥ 0`, `reserved ≤ on_hand` (so `available ≥ 0`).
  - A reservation exceeding `available` → **409 INSUFFICIENT_STOCK** with the offending items.
  - A manual movement that would reduce `on_hand` below `reserved` → **409 STOCK_RESERVED** (the affected orders must be handled first — risk AR-11).
  - Movements are **rejected, never clamped**. (The current UI clamps adjustments to 0 — temporary behaviour.)
  - Database check constraints enforce the invariants as the last line of defence.
- **R3.7 Status** is computed on **available**: `out` if available ≤ 0; `low` if available ≤ threshold; else `in`.
- **R3.8 Threshold** is per stock subject, ≥ 0. The default source for new subjects is **⚠ OPEN (Q-INV-4)** (C-4: Staffing 10 vs catalog 5). *Interim safe behaviour — not a decision:* a new subject takes Staffing → Low Stock Threshold as its initial threshold.
- **R3.9 Alerts.** Every movement emits `stock.changed`. A movement that moves status from `in` to `low` emits `stock.low`; to `out` emits `stock.out` — alerts shown if Features → Low Stock Alerts and Preferences → Low Stock Alerts are on (precedence ⚠ OPEN Q-SET-2).
- **R3.10 Permissions & gates.** Product stock: ⚑Inventory; restock ✱inventory.restock, adjust/correction/waste/threshold ✱inventory.adjust (protected). Ingredient stock: ⚑Ingredient Tracking; ✱ingredients.adjust (protected).
- **R3.11 Audit** of every restock, adjustment, correction and waste (§21).
- **R3.12 Concurrency:** one transaction, stock rows locked in deterministic order, conditional updates (R4.8, §20).

---

## 4. Reservation, sale finalization & availability

- **R4.1 Stock flags (Q-INV-1, DECIDED).** A product has two independent flags: `track_units` (sellable unit stock) and `track_ingredients` (recipe consumption, §4a) — either, both, or neither. When both are on, **both** must be sufficient. A product with neither has no stock effect. (Replaces the old `stock_mode` enum.)
- **R4.2 Reservation at creation (Q-INV-2, DECIDED).** Creating an order computes the required quantity per stock subject, aggregated across all lines:
  - units: line quantity (if `track_units`);
  - ingredients: Σ recipe line quantity × line quantity (if `track_ingredients`, R4a.3).

  All required quantities are reserved **atomically, all-or-nothing** (`reservation` movements, `reference_type = order`). Any shortfall → 409 INSUFFICIENT_STOCK; nothing is reserved or created.
- **R4.3 Release on cancel.** Cancelling before completion writes `reservation_release` movements for exactly the quantities reserved by that order.
- **R4.4 Sale at completion.** Completion converts the order's reservations into `sale` movements (on_hand −q, reserved −q) for exactly the reserved quantities. "Reserve/deduct at creation" is implemented as a reservation that becomes the finalized sale at completion.
- **R4.5 Reserved quantities are fixed** at creation; later recipe, flag or product edits do not change an existing order's reservation, release or sale quantities.
- **R4.6 POS availability** = min(unit availability, ingredient-limited availability), using only the applicable flags:
  - unit availability = `available` of the product's stock level;
  - ingredient-limited availability = min over recipe lines of ⌊ingredient `available` ÷ recipe quantity per unit⌋.
- **R4.7 Out of stock.** A product whose POS availability is < 1 is shown as unavailable and cannot be added; cart quantities above availability are refused. Creation re-validates under locks and rejects with the offending product/ingredient IDs.
- **R4.8 Deterministic lock order.** Order creation, completion, cancellation, restock and adjustments lock the affected `stock_levels` rows in a deterministic order (by subject_type, then subject_id) with a row lock (SELECT … FOR UPDATE), then apply conditional updates. Two terminals can never both consume the final stock; there is no silent overwrite (SR-3).
- **R4.9 Disabled tracking feature ⚠ OPEN (Q-FEAT-1).** Whether stock effects are recorded while Inventory or Ingredient Tracking is disabled is not decided.
- **R4.10 Offline** orders reserve against the terminal's local snapshot and are revalidated against server stock at sync (§19).

### 4a. Ingredients & recipes
- **R4a.1** Ingredient: name unique (case-insensitive), unit from {g, kg, ml, L, pcs}, stock via `stock_levels` (on_hand ≥ 0), unit cost ≥ 0 (up to 4 dp), threshold ≥ 0.
- **R4a.2** Recipe line quantity > 0 in the ingredient's unit (unit conversion **⚠ OPEN Q-ING-4**). An ingredient appears once per recipe.
- **R4a.3** Consumption per order line = Σ recipe line quantity × order line quantity (+ choice-option ingredient modifiers **⚠ OPEN Q-ING-2**). It is **reserved** at creation (`reservation` per ingredient, `reference = order`) and becomes `sale` movements at completion (R4.2–R4.4).
- **R4a.4** Product cost (for margins) = Σ recipe line quantity × ingredient unit cost (costing method **⚠ OPEN Q-ING-3**).
- **R4a.5** An ingredient used in any recipe or with any movement cannot be deleted — only deactivated (Q-DEL-1); a deactivated ingredient cannot be added to new recipe lines.
- **R4a.6** If ⚑Ingredient Tracking is off, recipes are editable only when re-enabled; consumption behaviour **⚠ OPEN (Q-FEAT-1)**.
- **R4a.7** Permissions: recipes and ingredient definitions ✱ingredients.recipes; ingredient stock ✱ingredients.adjust (both protected).

---

## 5. Discounts

- **R5.1 One discount per order (Q-DSC-1, DECIDED).** At most one `order_discounts` row per order (unique). Stacking is prohibited; per-item discounts are not supported. A second discount → **409 DISCOUNT_ALREADY_APPLIED**. The discount is chosen at order creation; adding or changing it afterwards is an order edit (⚠ OPEN Q-ORD-2, R1.7).
- **R5.2 Availability.** Only `active` discounts are offered; ⚑Discounts must be on; the actor needs ✱pos.applyDiscounts. Whether an Admin approval is required **⚠ OPEN (Q-DSC-4)** (with Q-AUTH-3); `approved_by` is recorded when approval applies.
- **R5.3 Minimum order:** if `min_order` is set and the order subtotal < `min_order` → **422 DISCOUNT_MIN_ORDER**.
- **R5.4 Amount.** Base = order subtotal at **listed prices** (Σ line totals incl. options). Percentage → base × pct ÷ 100; fixed → amount. Then cap: min(value, `max_discount`) if set; then never above the base (discount ≤ base; total never negative). Rounded per R0.2.
- **R5.5 Tax after discount (Q-TAX-2, DECIDED).** For ordinary discounts, tax is computed on the discounted amount (§6). The per-discount "Tax Handling" (Before Tax / After Tax / Not Applicable) control is superseded and **not part of the backend discount model** (C-12); the UI control is to be revised later.
- **R5.6 Senior Citizen / PWD (Q-DSC-2, DECIDED).** They are ordinary discount definitions with eligibility `senior` / `pwd` and, as ordinary discounts, follow R5.1–R5.5 while no statutory rule is enabled. How eligibility is established and recorded is ⚖ VR-2 (identification capture per R5.7). Any statutory legal/tax treatment is a **separate** configurable compliance rule (`compliance.statutory_rules`, disabled by default, carries verification metadata) that plugs into the pricing pipeline through a dedicated policy (SYSTEM-LOGIC §13). No statutory formula is defined in these documents. Its interaction with the one-discount rule and the tax pipeline must be verified before enabling, including whether it changes R5.1 (one discount) or R5.5 (tax after discount) (AR-17). ⚖ VR-1, VR-2
- **R5.7 Identification capture (Q-DSC-3, DECIDED).** Each definition has `requires_identification` (bool) and `identification_fields` ⊆ {customer name, ID type, ID number}. When set (intended for Senior Citizen/PWD), the order must carry those values in its discount snapshot (`order_discounts.customer_name`, `id_type`, `id_number`); missing → **422 IDENTIFICATION_REQUIRED**. No field is claimed to be legally mandatory. Personal-data handling:
  - stored only when the definition requires it;
  - visible only to authorized roles; masked in lists;
  - never included in real-time events or audit values (the audit records the capture event, not the value);
  - printing on documents is a compliance setting (§23). ⚖ VR-2, VR-7
- **R5.8 Snapshot.** `order_discounts` freezes discount_id, name, type, value, eligibility (+ label), computed amount, per-line allocation, identification values (if required) and `approved_by` (if any).
- **R5.9 Definition validation:** name unique; percentage 0 < x ≤ 100; fixed > 0 (2 dp); `max_discount` > 0 or null; for fixed, `max_discount` ≥ amount; `custom` eligibility requires a label; `requires_identification` ⇒ at least one identification field. There is no `tax_handling` attribute.
- **R5.10 Lifecycle.** Editing a definition affects new orders only. A discount applied to any order can be deactivated but not deleted (Q-DEL-1). Definition writes require ✱settings.discounts and ⚑Discounts.
- **R5.11 Audit** of discount application/authorization, including the identification-capture event (§21).
- **R5.12 Offline** use of discounts (especially identification-capture discounts) is **⚠ OPEN (Q-TRM-7)**.

---

## 6. Tax

Settings → Tax (business-wide): `enabled`, `name`, `rate` (0 < r ≤ 100 when enabled), `mode` (`included` / `excluded`), registration number, display flags `show_on_receipt`, `show_rate`, `show_breakdown`. Default: tax disabled, empty rate (SR-9).

- **R6.1 Taxability per product (Q-TAX-1, DECIDED).** `products.tax_class` ∈ {`taxable`, `non_taxable`} (baseline). Further classes (e.g. exempt vs zero-rated) are compliance configuration. ⚖ VR-4
- **R6.2 Tax disabled** → tax = 0 for every line; total = subtotal − discount.
- **R6.3 Pipeline and formulas (Q-TAX-2, DECIDED).** With r = rate ÷ 100:

  | Step | Formula |
  |---|---|
  | Line totals | Lᵢ = unit price × quantity (R2.4) |
  | Subtotal | S = Σ Lᵢ |
  | Discount | D per R5.4, on listed prices |
  | Allocation | dᵢ = D × Lᵢ ÷ S pro-rata by line amount, truncated to 0.01; the remaining cents go one each to the lines with the largest remainders (ties by line order) so Σ dᵢ = D exactly |
  | Discounted taxable amount | T = Σ (Lᵢ − dᵢ) over `taxable` lines (per tax class) |
  | Tax — included mode | tax = T − T ÷ (1 + r); total = S − D; net_amount = total − tax |
  | Tax — excluded mode | tax = T × r; total = S − D + tax; net_amount = S − D |
  | `non_taxable` lines | tax 0 |

  Tax is computed **once per order per tax class** and rounded per R0.2. Pro-rata allocation across taxable/non-taxable lines is a technical rule that may need verification (AR-18). ⚖ VR-4
- **R6.4 Freeze on order:** `tax_name`, `tax_rate`, `tax_mode`, `tax_amount`, `net_amount` (and per-class amounts) are frozen at creation. Tax settings changes apply to new orders only.
- **R6.5 Document display:** tax line shown only if `show_on_receipt`; rate shown only if `show_rate`; "amount before tax" only if `show_breakdown`; registration number printed if set and tax shown, unless a compliance must-print lock requires it regardless of display toggles (R23.2) ⚖ VR-3. Overlap with Receipts → "Show Tax" is **⚠ OPEN (Q-SET-2)** (C-3). Compliance must-print locks override display toggles when set (R23.2).
- **R6.6 Enabling tax** requires a name and a valid rate; otherwise the settings write is rejected (422 VALIDATION_ERROR).
- **R6.7 No hard-coded rate.** The rate is configuration only. The current POS mock `MOCK_VAT_RATE = 0.12` (12 %, VAT-inclusive, hard-coded in the UI) is temporary and must be replaced by the tax settings.
- **R6.8 Statutory treatment** (Senior Citizen/PWD) is not part of this ordinary pipeline; it is a separate compliance policy (R5.6). ⚖ VR-1, VR-4

---

## 7. Payments & settlement

- **R7.1 Methods.** `payments.method` ∈ {`cash`, `gcash`, `card`, `bank_transfer`}; the method must be enabled in Settings → Payments, else **422 METHOD_NOT_ENABLED**. At least one method is always enabled (the settings API rejects disabling the last). Other methods **⚠ OPEN (Q-PAY-4)**.
- **R7.2 Split payments (Q-PAY-1, DECIDED).** An order may have several payments of different methods (e.g. total ₱500 = cash ₱300 + GCash ₱200). Each is a separate immutable `payments` record: method, amount, tendered, change_given, rounding_adjustment, reference, status, confirmed_by/at, terminal, user, idempotency_key, origin. ✱pos.processPayments.
- **R7.3 When.** Payments may be recorded while the order is `pending`, `preparing` or `ready` and not yet `paid`. Not on `completed` or `cancelled` orders (409 INVALID_TRANSITION).
- **R7.4 Remaining balance** = total − Σ completed (amount + rounding_adjustment) − Σ pending amount. A new payment amount must be > 0 and ≤ remaining balance (for a rounded settling cash payment the cap applies to `amount + rounding_adjustment`, which equals the remaining balance exactly — R7.7), else **422 OVERPAYMENT** — pending payments therefore can never lead to overpayment. Computed with the order row locked (§20).
- **R7.5 Settlement.** Only `completed` payments count. The order is **`paid`** when Σ over completed payments of (`amount` + `rounding_adjustment`) = order `total`; `partially_paid` when that sum is > 0 but < total; else `unpaid`. `payment_status` is server-derived; refunds do not change it (they update `refund_status`, §10). A change emits `order.payment_status_changed`.
- **R7.6 Cash.** If `require_cash_received` is on, `tendered` is required. `tendered` ≥ amount, else **422 INSUFFICIENT_TENDER**. `change_given = tendered − amount` is always computed by the server; `auto_change` only controls whether the UI displays it. How `auto_change` and `require_cash_received` interact is **⚠ OPEN (Q-SET-2)** — *Interim safe behaviour — not a decision:* the server always computes and stores `change_given` whenever `tendered` is recorded; the toggles control UI prompts/display only. Opening the drawer is a device action triggered only when `open_drawer` is on and the cash payment completes (device integration ⚠ OPEN Q-ARCH-4).
- **R7.7 Cash rounding (Q-PAY-2, DECIDED).** Business setting `payments.cash_rounding = { enabled, increment, mode }` (mode `nearest` / `down` / `up`).
  - Applied **only** to a cash payment that settles the full remaining balance while rounding is enabled; non-cash payments and partial cash payments use the exact amount.
  - collected = remaining rounded to `increment` by `mode`; payment `amount` = collected; **`rounding_adjustment = remaining − collected`** is stored explicitly on the payment (never hidden inside totals).
  - The order total is not changed; the sales document shows the rounding line per display/compliance settings; analytics reports it separately (R16.10).
  - Increment and mode values are configuration, not facts; defaults ⚠ OPEN Q-SET-4. ⚖ VR-5
- **R7.8 References.** GCash / Card / Bank Transfer are exact-amount payments (no tendered/change). If the method's `require_reference` is on → reference required, trimmed, 4–40 chars, else **422 REFERENCE_REQUIRED**. References are recorded as given.
- **R7.9 Confirmation.** If the method's `require_confirmation` is on, the payment is created `pending` and becomes `completed` on confirmation (`POST /payments/{id}/confirm`, sets `confirmed_by`, `confirmed_at`). What confirmation means (who, how) is **⚠ OPEN (Q-PAY-3) ★**. Pending payments count toward the remaining-balance cap (R7.4) but not toward settlement.
- **R7.10 Statuses.** `pending` → `completed`; `pending` → `voided` (`POST /payments/{id}/void`, pending only). A completed payment is never edited or voided; reversal only through a refund (§10). Events: `payment.recorded`, `payment.confirmed`, `payment.voided`.
- **R7.11 Idempotency.** Idempotency-Key required on `POST /orders/{id}/payments`; the order row is locked while computing the remaining balance; retries never create a duplicate payment (SR-3).
- **R7.12 Settling transaction.** The payment (or confirmation) that makes the order `paid` issues the sales document in the same transaction (§8).
- **R7.13 Offline: cash only (Q-TRM-4, DECIDED).** GCash/Card/Bank Transfer are unavailable while offline; paying orders created online is unavailable offline (§19).
- **R7.14 No external provider** is called; BrewSync records payments, it does not process them.

---

## 8. Sales documents

"Sales document" is the neutral term (UI label "Receipt"). `documents.document_type` ∈ {`sales`, `refund`}; titles are configured in compliance settings. The primary sales document type/title is **configured, not assumed**. No automatic BIR/legal compliance is claimed. ⚖ VR-3

- **R8.1 Separate identifiers (Q-RCP-1, DECIDED).** Order number (`orders.number`, operational, gaps acceptable — R1.8) and sales document number (`documents.number`, allocated from a `document_series`) are separate.
- **R8.2 Issue timing.** One sales document is issued per order when the order becomes fully settled (`paid`), inside the settling payment/confirmation transaction. A pre-payment order slip / bill is **⚠ OPEN (Q-RCP-3)** ⚖ VR-3 — *Interim safe behaviour — not a decision:* nothing issued before full settlement is numbered from a sales document series.
- **R8.3 Numbering (Q-RCP-2, DECIDED).** The number is allocated from the applicable `document_series` inside the issuing transaction with a row lock; **gap-free within a series** is a technical design goal, not a legal claim. Series configuration — format template, scope (business or terminal), start number, optional allocated ranges, reset policy — lives in the compliance settings. A default neutral series is initialized at its start value (SR-9). ⚖ VR-3
- **R8.4 Snapshot content** (immutable): business header (name, address, phone, registration details as configured), terminology labels, document type/title, order number/type/tag, items with options, discount (identification values only if the compliance printing policy allows), tax lines per display flags, payment(s) with method/reference/tendered/change/rounding adjustment, cashier name, terminal code, `issued_at`, heading / thank-you / footer / small-print texts, formatting in effect.
- **R8.5 Formatting** comes from Settings → Receipts (display settings, **complete in the UI**): printed/digital format, receipt logo (which logo prints **⚠ OPEN Q-RCP-4**, C-2), header toggles, transaction-information toggles, heading / thank-you / footer / small-print texts. Display changes affect future documents only.
- **R8.6 Compliance locks.** "Must print" field locks in the compliance settings override display toggles. Mandatory content is not decided in these documents. ⚖ VR-3
- **R8.7 Reprint.** Same number and content; `print_count += 1`; a `document_prints` row (actor, terminal, time) and an audit record; ✱receipts.reprint; never creates a new transaction or number. Copies carry the reprint marker text from compliance settings (reprint marking ⚖ VR-3); reprints from the archive may add an "archived copy" display indication that never replaces the compliance marker (R12.8).
- **R8.8 Status after refunds:** `issued` → `partially_refunded` / `refunded` (R10.11). `void` only if verified rules allow. ⚖ VR-3
- **R8.9 Refund documents** (`document_type = refund`): issuance and numbering follow compliance configuration. ⚖ VR-3
- **R8.10 Offline sales (Q-RCP-5 ⚠ OPEN ★ ⚖ VR-3).** Until resolved, an offline sale prints only a provisional slip that is **not** a sales document; the sales document is issued when the transaction is committed at sync (§19, AR-2).
- **R8.11** Documents and document prints are never deleted or edited (§22). Endpoints: `GET /documents`, `GET /documents/{id}`, `POST /documents/{id}/reprint`.

---

## 9. Cancellation

- **R9.1** Allowed from `pending`, `preparing`, `ready` with a reason (required, ≤ 200 chars); ✱pos.cancelOrders (protected; Cashier off by default). Idempotency-Key required; `expected_version` checked; order row locked.
- **R9.2** Reservations are released with `reservation_release` movements (R4.3).
- **R9.3** Pending payments on the order are voided in the same transaction.
- **R9.4 Orders with completed payments ⚠ OPEN (Q-CAN-1) ★** (interacts with the Refunds toggle, C-19, AR-14). *Interim safe behaviour — not a decision:* cancellation is rejected (409 CONFLICT) while the order has any `completed` payment.
- **R9.5** Preferences → Require Confirmation Before Canceling Order is a UI prompt only; the server rule is R9.1.
- **R9.6** A cancelled order is terminal, stays in the Admin review list, is never auto-archived (§12), is audited and emits `order.cancelled`.
- **R9.7** Cancelling orders created online is unavailable offline (§19).

---

## 10. Refunds

- **R10.1 Toggle (Q-REF-4, DECIDED).** ⚑Refunds (Settings → Features → Refunds). ON → users with ✱pos.processRefunds may refund. OFF → refund endpoints return **403 FEATURE_DISABLED** and the UI hides refund actions. Historical refunds remain visible either way.
- **R10.2 Authorization:** ✱pos.processRefunds (protected). Extra Admin approval **⚠ OPEN (Q-DSC-4 / Q-AUTH-3)**.
- **R10.3 Completed orders only.** Money returned on a paid-but-not-completed order is Q-CAN-1 (§9).
- **R10.4 Full and partial refunds (Q-REF-1, DECIDED).** Partial refund granularity (by line/quantity vs arbitrary amount) is **⚠ OPEN (Q-REF-5) ★** — Full and partial refunds are both supported; the partial-refund request shape is fixed when Q-REF-5 is decided.
- **R10.5 Amount** is computed by the server (from the refunded lines/quantities or the full refundable amount), rounded per R0.2. A client amount is a request only.
- **R10.6 Cap:** Σ refunds ≤ Σ completed payment `amount` for the order, else **422 REFUND_EXCEEDS_REFUNDABLE**. Checked with the order row locked.
- **R10.7 Separate records.** Each refund is a new immutable record linked to the original order, its sales document and the payment(s) it returns: `refunds` (amount, reason, restocked, approved_by, user, terminal, idempotency_key), `refund_lines` (what is refunded), `refund_allocations` (per payment: amount, method, reference; Σ allocations = refund amount; each ≤ that payment's unrefunded amount).
- **R10.8 Open details:** refund method, time limit and allocation across split payments **⚠ OPEN (Q-REF-2) ★** ⚖ VR-8; restock on refund **⚠ OPEN (Q-REF-3)** — if yes, `sale_reversal` movements reference the refund.
- **R10.9 Reason** is required.
- **R10.10 Idempotency-Key** required on `POST /orders/{id}/refunds`; retries never duplicate a refund.
- **R10.11 Never edits the original.** The order, its payments and the document snapshot are unchanged. `orders.refund_status` → `partially_refunded` / `refunded` (refunded when Σ refunds = Σ completed payment amount) and `documents.status` updated accordingly. Refund document numbering ⚖ VR-3 (R8.9).
- **R10.12 Audit** + `refund.recorded` event.
- **R10.13 Analytics** count refunds by **refund date**, not sale date (R16.1).
- **R10.14** Refunds are unavailable offline.

---

## 11. Completion

- **R11.1** Completion requires status `ready` (or a permitted forward skip from `pending`/`preparing`, R1.4) **and** `payment_status = paid`, else **409 ORDER_NOT_SETTLED**. ✱orders.complete. Idempotency-Key required; `expected_version` checked.
- **R11.2 One transaction:** lock order row → check status + settlement → convert reservations into `sale` movements (R4.4) → `completed_at`, version + 1 → `order.completed` event. The order moves to History and becomes eligible for automatic archive (§12).
- **R11.3 No double completion.** The row lock and version check guarantee a second attempt fails (409 INVALID_TRANSITION) or, with the same Idempotency-Key, returns the stored outcome.
- **R11.4** Preferences → Automatically Clear Completed Order / Return to POS are UI behaviours only.
- **R11.5** Orders completed offline are committed at sync (§19).

---

## 12. Archiving, restoration & retention

- **R12.1** Only `completed` and `cancelled` orders can be archived. Archive is a flag (`archived_at`, `archived_by`, `archive_reason`), not a status, and **never deletes**.
- **R12.2 Automatic (Q-ARC-1, Q-ARC-4, DECIDED).** A server-side scheduled job archives `completed` orders once `completed_at` + `archiving.auto_archive_after` has passed (business timezone), as the system actor, audited, emitting `order.archived`. Default timing ⚠ OPEN Q-SET-4.
- **R12.3 Cancelled orders are never auto-archived.** They remain in an Admin review list until an Admin archives them manually.
- **R12.4 Manual archive.** An Admin (✱archive.manage — Admin-only until Q-SET-3) may archive cancelled orders and may archive completed orders before the automatic timing; reason required; audited.
- **R12.5** Archived orders leave the active Orders board and the default History view but stay in reports and in search with an "Archived" filter.
- **R12.6 Restore (Q-ARC-2, DECIDED).** Only completed orders; only authorized Admins (✱archive.manage); only within `archiving.restore_window` counted from `archived_at`, else **409 RESTORE_WINDOW_EXPIRED**. Restored orders return to History, never to the active board. Audited; `order.restored`. The UI constant `RESTORE_WINDOW_HOURS = 48` is a temporary placeholder (C-10).
- **R12.7** A restored order is excluded from automatic re-archiving; manual re-archive is allowed (AR-13).
- **R12.8** Reprint from the archive is allowed; it keeps the original number and carries the reprint marker text from compliance settings (an additional "archived copy" indication is display text only and never replaces a configured compliance marker). ⚖ VR-3
- **R12.9 Retention (Q-ARC-3, DECIDED).** `archiving.retention_period` must be ≥ `compliance.retention_minimum` (entered only after verification); lower values → **422 RETENTION_BELOW_MINIMUM**. Where applicable requirements demand longer retention, the longer period applies. **Until a verified minimum is configured, nothing is disposed.** No legal period is stated anywhere. End-of-retention handling (keep / export-then-purge / anonymize) is **⚠ OPEN (Q-ARC-5)** (C-18, AR-12). Retention configuration is audited. ⚖ VR-6, VR-7
- **R12.10** Archive, restore and retention changes are unavailable offline.

---

## 13. Roles, permissions & admin protection

- **R13.1** Every endpoint declares its required permission; the server checks the role grant on every request (PERMISSIONS §2). The 48 existing keys are unchanged. Gap keys — `archive.manage`, `history.export`, `settings.terminology`, `terminals.manage`, `settings.security`, `settings.archiving`, `settings.offline`, `settings.compliance`, `sync.review`, `audit.view` — are **Admin-only** until **⚠ OPEN Q-SET-3** is decided.
- **R13.2** Protected permissions (management functions) are never granted to Cashier by default; granting them requires Admin + confirmation and is audited.
- **R13.3 Admin protection:** the system must always have ≥ 1 active Admin. Reject: deactivating/demoting the last active Admin, removing `staff.managePermissions` or `settings.view` from the Admin role, and a user changing their own role or their own role's grants.
- **R13.4** Maximum Administrators / Staff Accounts (Staffing) are enforced on create and on re-activation (409 LIMIT_REACHED), never retroactively.
- **R13.5 Username rename ⚠ OPEN (Q-AUTH-5).** *Interim safe behaviour — not a decision:* username is immutable after creation (the Account page shows it read-only).
- **R13.6** Permission changes take effect on the next request; they are audited and emit `settings.changed` (section `permissions`); a user's role change emits `staff.status_changed`.
- **R13.7** Credentials are never readable by anyone. Admin Mode / Lock Admin is **⚠ OPEN (Q-AUTH-3)**.

---

## 14. Terminals, authentication & sessions

- **R14.1 Registration & activation (Q-TRM-1, DECIDED).** Admin creates a terminal (code, name) ✱terminals.manage → server issues a one-time, short-lived activation code (shown once, stored hashed) → the physical device enters it during device setup (`POST /terminals/activate`) → the server binds the device by issuing a device credential (secret kept on the device, hash stored on the server) → terminal `active`. Invalid/expired/used code → **400 ACTIVATION_CODE_INVALID**.
- **R14.2 Identity.** Terminal identity at login is derived from the device credential (`X-Device-Credential`), never from a client-supplied code; a device cannot claim an arbitrary terminal. Requests requiring a terminal from a device that is not activated → **403 TERMINAL_NOT_ACTIVATED**.
- **R14.3 Statuses & lifecycle:** `pending_activation` · `active` · `inactive` · `revoked`. Admin may deactivate or reset activation (revokes the credential, issues a new code); sessions on that terminal end (`terminal_revoked`). All steps audited; `terminal.status_changed` emitted.
- **R14.4 Limits:** active terminals ≤ Staffing → Maximum Active Terminals, enforced at activation/reactivation (409 LIMIT_REACHED); lowering the limit is not retroactive.
- **R14.5** A session binds user + terminal; orders, payments, documents, movements and audit records record both.
- **R14.6 Authentication methods (Q-AUTH-2, DECIDED).** `users.auth_method` ∈ {`password`, `pin`}. Admin accounts must use `password` (`pin` → **422 AUTH_METHOD_NOT_ALLOWED**). Cashier accounts use `password` or `pin`, selected per account by an Admin in Staff. The server accepts only the account's selected method. PIN sign-in only from an activated terminal.
- **R14.7 Credentials** are stored with a strong adaptive hash. Reset (`POST /staff/{id}/reset-credential`, ✱staff.resetPasswords) issues a temporary password or PIN once and sets `must_change_credential`; the user must change it before anything else. Set/change/reset are audited.
- **R14.8 Credential policy values** (length, complexity, lockout thresholds) **⚠ OPEN (Q-AUTH-7) ★** — one server-enforced policy (resolves C-1 in principle).
- **R14.9 Lockout:** failed attempts are counted; exceeding the limit locks the account (**423 ACCOUNT_LOCKED**, `locked_until`); audited (AR-9).
- **R14.10 Idle timeout (Q-AUTH-4, DECIDED).** `security.idle_timeout_minutes`, business-wide, from an allowed list (approved candidate values 5, 10, 15, 30, 60). The server updates `sessions.last_activity_at` on user-initiated requests only (not real-time heartbeats or background refresh) and ends a session idle longer than the timeout (end_reason `idle_timeout`, **401 SESSION_EXPIRED**). The client timer is UX only; offline enforcement is local (AR-3). Default ⚠ OPEN Q-SET-4.
- **R14.11 Manual lock:** `POST /auth/lock` (end_reason `lock`) returns the terminal to Login with the user pre-filled; resuming requires the user's credential (`POST /auth/unlock`).
- **R14.12** Deactivating a user ends their sessions immediately (end_reason `user_deactivated`).
- **R14.13 Staff restricted to assigned terminal ⚠ OPEN (Q-TRM-6).** *Interim safe behaviour — not a decision:* a staff member's default terminal is a sign-in preference, not a restriction.
- **R14.14 Concurrent sessions per user ⚠ OPEN (Q-AUTH-6).**
- **R14.15** Events: `session.started`, `session.ended`, `terminal.status_changed`.

---

## 15. Expenses

- **R15.1** ⚑Expenses must be on; ✱expenses.record.
- **R15.2** Amount > 0 (2 dp); date required, not later than today (business timezone); category from the fixed list (Supplies, Ingredients, Utilities, Rent, Equipment, Maintenance, Transportation, Marketing, Other) — custom categories **⚠ OPEN (Q-EXP-2)**; payment method from (Cash, GCash, Card, Bank Transfer, Other); description required ≤ 120 chars; notes ≤ 500.
- **R15.3** `recorded_by` is the authenticated user (not free text as in the current UI).
- **R15.4** Code `EXP-YYYY-NNN` from a yearly sequence.
- **R15.5** Edits require ✱expenses.edit and are audited (before/after). Delete vs void **⚠ OPEN (Q-EXP-1)** — the approved principle "operational records that affect history must not be hard-deleted" points to void-with-reason; to be confirmed.
- **R15.6** Recording an "Ingredients" expense does **not** restock ingredients (restock is a separate Inventory/Ingredients action).
- **R15.7** Expenses are unavailable offline.

---

## 16. Analytics

All figures come from persisted orders, payments, refunds, documents, expenses and movements, in the business timezone, **excluding cancelled orders** (and unpaid active orders are not sales).

- **R16.1** Gross sales = Σ order `total` of paid orders by **settlement date** (the date the order became `paid` = sales document `issued_at`). Net sales = gross − refunds by **refund date**. Tax collected = Σ `tax_amount`. Discounts given = Σ discount amounts. For orders with `origin = offline`, `issued_at` is the sync commit time, not the sale date; attribution follows R16.11 (not yet defined, AR-5).
- **R16.2** Orders count = paid orders; average order value = gross sales ÷ orders count.
- **R16.3** Channel mix by `order_type`; payment mix by method (completed payment amounts).
- **R16.4** Product performance: units and revenue per product from order items (snapshot names grouped by product_id).
- **R16.5** Expenses = Σ non-void expenses by expense date; by category.
- **R16.6** Estimated gross profit = net sales − COGS (recipe cost at sale time, from `sale` movements) − (optionally) expenses; COGS only when ingredient tracking is on. Labelled as an estimate.
- **R16.7** Comparison period = same-length period immediately before.
- **R16.8** Inventory insights = current low/out counts (on available, R3.7) and stock value (on_hand × unit cost).
- **R16.9** ⚑Analytics off → analytics endpoints return 403 FEATURE_DISABLED. ✱analytics.view / ✱analytics.insights.
- **R16.10** Cash rounding (Σ `rounding_adjustment`) is reported separately, never hidden inside sales or discounts.
- **R16.11** Offline sales: `captured_at` (device, untrusted) and `received_at` (server) are both stored; the business-day attribution rule is not yet defined (AR-5, SYSTEM-LOGIC §14).
- **R16.12** Analytics is unavailable offline.

---

## 17. Settings

- **R17.1 Business-wide (Q-SET-1, DECIDED).** One settings document per section per business, applied consistently on every terminal and user. User/terminal security and session state (credentials, sessions, lock state, terminal activation) are separate records, not preferences. Account = the caller's own user record, not a settings document.
- **R17.2 Sections:**

  | Section | Notes |
  |---|---|
  | `business`, `branding`, `terminology`, `features`, permissions (role grants), `tax`, `payments` (+ `cash_rounding`), discounts (rows), `staffing`, `preferences` | Existing UI |
  | `receipts` | Display only — **complete in the UI** (printed/digital format, receipt logo, header toggles, transaction-info toggles, heading / thank-you / footer / small-print texts) |
  | `security` | `idle_timeout_minutes`, credential policy (Q-AUTH-7) — backend only, UI later |
  | `archiving` | `auto_archive_after`, `restore_window`, `retention_period` — backend only, UI later |
  | `offline` | `enabled`, `sync_review_threshold`, limits (Q-TRM-7) — backend only, UI later |
  | `compliance` | document types/titles, document series, must-print locks, reprint marker text, `statutory_rules`, `retention_minimum`, identification display/printing policy — every value ⚖ (§23) |

- **R17.3 Writes** require ✱settings.<section> (new sections and terminology: Admin-only until Q-SET-3), send the current `version` (stale → **409 VERSION_CONFLICT**), are stored with history (`settings_history`), audited, and emit `settings.changed`.
- **R17.4 Cross-rules** (violations → 422 VALIDATION_ERROR unless noted):
  - tax enabled ⇒ name and rate valid (0 < r ≤ 100);
  - payments ⇒ ≥ 1 method enabled; cash rounding enabled ⇒ increment > 0 and mode ∈ {nearest, down, up};
  - staffing ranges: admins 1–10, staff 1–100, terminals 1–25, low stock 0–10 000, order waiting 1–240 min;
  - `security.idle_timeout_minutes` ∈ the allowed list;
  - `archiving.retention_period` ≥ `compliance.retention_minimum` (**422 RETENTION_BELOW_MINIMUM**);
  - durations (`auto_archive_after`, `restore_window`, `retention_period`, `sync_review_threshold`) positive.
- **R17.5** Settings changes never rewrite historical orders or documents (snapshots, R0.5).
- **R17.6** Terminology changes display strings only (never API/DB names).
- **R17.7** Branding cannot override semantic status colours.
- **R17.8** A staffing limit lowered below current usage is allowed; it blocks only new creations.
- **R17.9 Defaults** for newly configurable settings (auto-archive timing, restore window, retention, idle timeout, offline enabled/threshold/limits, cash rounding) **⚠ OPEN (Q-SET-4) ★**.
- **R17.10 Overlapping controls** (Features vs Preferences, Tax vs Receipts) precedence **⚠ OPEN (Q-SET-2)** (C-3, C-5). Compliance locks override display toggles (R23.2).
- **R17.11** Settings cannot be changed offline; offline terminals use the last synchronized snapshot.

---

## 18. Fresh system & first-run setup

- **R18.1 Fresh system (SR-9).** Production initialization seeds **only**: roles, the permission catalogue, default role grants, default settings documents (neutral values; tax disabled, no rate), sequences and a default neutral document series at start values, and `system_state.setup_status = not_started`. It **never** seeds products, categories, choices, ingredients, inventory, orders, payments, documents, expenses, customers, discounts, analytics or fake staff. The business row and first Admin are created by the owner in the wizard.
- **R18.2 First-run wizard (Q-AUTH-1, DECIDED):** Fresh Installation → Business Setup → Create First Admin → Complete Setup → Login. `setup_status`: `not_started` · `in_progress` · `completed`.
- **R18.3 Setup-state guard.** Before completion only `/setup/*` and `/health` work (others → **409 SETUP_REQUIRED**); after completion `/setup/*` permanently returns **409 SETUP_ALREADY_COMPLETED** — except read-only `GET /setup/status`, which always answers (reports `completed`) so a device can choose between the wizard and Login (C-23).
- **R18.4 Complete Setup** is one atomic transaction: business row + first Admin (`auth_method = password`) + setup completed + audit.
- **R18.5 No default password.** No default or shipped password exists; the owner chooses the Admin password (policy Q-AUTH-7).
- **R18.6 Open:** protection of the wizard on a fresh, network-reachable install **⚠ OPEN (Q-AUTH-8) ★** (AR-8); how the setup device becomes the first terminal / Admin access without a terminal **⚠ OPEN (Q-TRM-8) ★**.
- **R18.7** Demo/sample data generators are excluded from production builds and never write to the database.
- **R18.8 Temporary UI data (SR-10).** Current frontend mock/demo data (e.g. `posMockData.ts` incl. `MOCK_VAT_RATE = 0.12`, orders/receipts/history/admin-overview mock data, opt-in analytics demo data, dev-only archived sample data) and in-memory stores must be removed or replaced with live backend data in the integration phase; they are **not** removed in Phase 3B. UI behaviour that no longer matches these rules (pay-first single-payment POS, Discounts "Tax Handling", `RESTORE_WINDOW_HOURS = 48`, fixed terminal list, no PIN/activation/wizard, full-only refunds, no ID capture, no offline/cash-rounding UI) is revised in a later UI phase (SYSTEM-LOGIC §8).
- **R18.9** After setup, the POS is usable once ≥ 1 active, available product and ≥ 1 payment method exist; until then it shows an empty state.

---

## 19. Offline operation

- **R19.1 Limited offline operation (Q-TRM-2, DECIDED)** is a business setting `offline.enabled` (default ⚠ OPEN Q-SET-4).
- **R19.2 Baseline scope (Q-TRM-3, DECIDED; details ⚠ OPEN Q-TRM-7 ★):**

  | Allowed offline | Not available offline | To confirm (Q-TRM-7) |
  |---|---|---|
  | Continue an already-authenticated session on an activated terminal | GCash / Card / Bank Transfer | Discounts offline (esp. ID-capture discounts) |
  | Create orders from the last synchronized snapshot | Refunds | New sign-in while offline |
  | Cash payments | Cancelling or paying orders created online | Reprint offline |
  | Local stock tracking that blocks sales when local available stock is insufficient | Restock / adjustments | Offline limits (max duration / queued count / value) |
  | Local status changes for orders created offline on that terminal | Catalog, settings, staff, terminal changes; archive/restore; analytics; expenses; terminal activation | Status changes on online orders |
  | Print a provisional slip (not a sales document, R8.10) | | |

- **R19.3 Cash only (Q-TRM-4, DECIDED).**
- **R19.4 Transaction identity.** Each offline transaction gets a device-generated unique `client_txn_id` (UUID) and a provisional `offline_ref`; the canonical order number is assigned at commit (R1.8).
- **R19.5 Local snapshot.** Offline pricing uses the last synchronized `pos_snapshots` bundle (`catalog_version`); the submission records `snapshot_version`. The server retains snapshots to recompute offline totals (AR-4).
- **R19.6 Local stock (SR-5).** Local available stock = snapshot minus local effects; sales exceeding it are blocked; every local stock effect is recorded in the queue. Global stock accuracy cannot be guaranteed while disconnected (AR-1).
- **R19.7 Queue (Q-TRM-5, DECIDED).** Queued transactions persist on the device until the server confirms them. Nothing is silently lost, merged or rewritten; sign-out/clearing is blocked while unsynced items exist and the queue count is visible (AR-6).
- **R19.8 Sync steps (SR-4):** send queued transaction → server persists the raw submission (`offline_submissions`, unique `client_txn_id`, status `received`) → idempotency check (a duplicate returns the stored outcome) → validate terminal, user, snapshot version, prices recomputed from the stored snapshot, discount, cash-only → validate inventory/payment/order state under locks → commit (canonical order number, payments, movements, sales document, audit, events; status `committed`) → client marks synced.
- **R19.9 Actor validity.** At sync the server re-validates actor validity as it stands at sync: if the user has been deactivated, a required permission revoked, or the terminal revoked since capture (or any of these was already invalid), the submission is flagged `needs_review`. `captured_at` is untrusted (R0.4) and is never used to prove validity.
- **R19.10 Conflicts** (e.g. insufficient server stock — negative stock is never auto-committed, Q-INV-3; totals not reproducible from the snapshot; invalid discount; non-cash payment) → `needs_review` with `conflict_reasons`; **nothing** is applied to stock or money; `sync.review_required` emitted.
- **R19.11 Review threshold.** A transaction not committed within `offline.sync_review_threshold` (time since capture and/or failed attempts) is flagged `needs_review` for an Admin (server side when received/attempted; device-side warning).
- **R19.12 Admin reconciliation.** ✱sync.review (Admin-only until Q-SET-3) via `GET /sync/reviews`, `POST /sync/reviews/{id}/resolve` → `resolved` with resolution, `resolved_by/at`, resulting order. Audited. The original submission is never modified; server stock is never overwritten — stock corrections only via explicit Admin movements.
- **R19.13 Documents:** offline sales get only a provisional slip until Q-RCP-5 is resolved (R8.10). ⚖ VR-3
- **R19.14** Authentication and idle timeout cannot be enforced by the server offline (AR-3); offline sign-in is Q-TRM-7 / Q-AUTH-7.

---

## 20. Real-time & concurrency

- **R20.1 Real-time while online (SR-1).** Events: `order.created`, `order.status_changed`, `order.cancelled`, `order.completed`, `order.archived`, `order.restored`, `payment.recorded`, `payment.confirmed`, `payment.voided`, `order.payment_status_changed`, `refund.recorded`, `stock.changed`, `stock.low`, `stock.out`, `alert.order_overdue`, `settings.changed`, `terminal.status_changed`, `session.started`, `session.ended`, `staff.status_changed`, `sync.review_required`. Transport **⚠ OPEN (Q-ARCH-3) ★**; Live Updates precedence ⚠ OPEN Q-SET-2.
- **R20.2 Delivery.** Events are written to the outbox in the business transaction and published after commit, with a per-business `sequence`; clients resume from `last_sequence`; beyond the replay window → **409 RESYNC_REQUIRED** and the client refetches (AR-16).
- **R20.3 Payloads** are minimal and permission-filtered — never ID numbers, credentials, or costs to roles without the permission.
- **R20.4 Server wins (SR-2).** Optimistic client state is reverted when the server rejects or returns a different result.
- **R20.5 Inventory (SR-3):** one transaction; stock rows locked in deterministic order (R4.8); conditional updates; check constraints as last defence; no silent overwrite.
- **R20.6 Orders (SR-3):** `version` + server state machine; invalid transitions → 409 INVALID_TRANSITION; stale version → 409 VERSION_CONFLICT; completion locks the row and checks status + settlement (no double completion).
- **R20.7 Payments/refunds (SR-3):** Idempotency-Key; order row locked while computing remaining balance / refundable amount; retries never create duplicate records (AR-15).
- **R20.8** Sequences and document series are incremented with a row lock inside the owning transaction; settings use version checks (R17.3).

---

## 21. Audit

- **R21.1 Immutable `audit_logs` (SR-7)** for: refunds; discount application/authorization (incl. identification-capture event, not the ID value); inventory restock/adjust/correction/waste; manual archive; automatic archive (system actor); restore; cancellation; reprint; staff create/edit/deactivate/role change; permission changes; settings changes (all sections, incl. compliance); password/PIN set, change, reset; lockouts; setup completion; terminal registration/activation/reset/deactivation; offline reconciliation decisions; retention configuration.
- **R21.2** Each record holds actor (or system actor), terminal, action, entity type/id, before/after, ip, user agent, time. Credentials and identification values are never written to audit data.
- **R21.3** Audit records are never edited or deleted. Viewing requires ✱audit.view (Admin-only until Q-SET-3), `GET /audit`.

---

## 22. History preservation

- **R22.1 Never hard-delete (SR-6):** orders (incl. completed and cancelled), order items / item choices / discounts, payments, refunds (+ lines, allocations), sales documents, document prints, stock movements, audit logs, settings history, offline submissions.
- **R22.2 Configuration objects (Q-DEL-1, DECIDED):** products, categories, ingredients, choice groups/options, discounts, staff accounts and terminals may be hard-deleted **only if never referenced**; otherwise they are deactivated/archived. History renders from snapshots.
- **R22.3 Expenses:** delete vs void **⚠ OPEN (Q-EXP-1)** (R15.5).
- **R22.4 Retention vs never-delete** (C-18) is reconciled: nothing is disposed until a verified minimum is configured; end-of-retention handling ⚠ OPEN Q-ARC-5 (R12.9). ⚖ VR-6

---

## 23. Compliance configuration & verification

- **R23.1 Two kinds of settings.** *Display* settings (Settings → Receipts, tax display flags) control presentation. *Compliance* settings (`compliance` section) hold document types/titles, document series, must-print field locks, reprint marker text, `statutory_rules`, `retention_minimum`, and the identification display/printing policy. Compliance values are kept separate from display settings; every compliance value is ⚖.
- **R23.2 Precedence.** When a compliance must-print lock is set, it overrides the corresponding display toggle.
- **R23.3 No compliance claim.** BrewSync does not claim automatic BIR or other legal compliance; no field, rate, period, rounding step or document type is stated as legally mandatory. The architecture keeps these as configuration so verified requirements can be implemented without redesign (SR-11).
- **R23.4 Verification register** (must be verified before production; status in [DECISIONS.md](DECISIONS.md)):

  | VR | Topic | Related | Rules here |
  |---|---|---|---|
  | VR-1 | Senior Citizen / PWD statutory treatment (discount & tax/VAT treatment, receipt/report content) | Q-DSC-2 | R5.6, R6.8 |
  | VR-2 | Required identification / recordkeeping for Senior/PWD | Q-DSC-3 | R5.7 |
  | VR-3 | Invoicing / sales document requirements (type/title, numbering, series/ranges, registration, mandatory content, reprint marking, refund documents, offline issuance) | Q-RCP-1, Q-RCP-2, Q-RCP-3, Q-RCP-5 | §8, R10.11, R19.13 |
  | VR-4 | Tax-specific treatment (taxability classes, rate, inclusive/exclusive, tax after discount, rounding method) | Q-TAX-1, Q-TAX-2, Q-TAX-3 | R0.2, §6 |
  | VR-5 | Cash rounding requirements (whether permitted, increments, display) | Q-PAY-2 | R7.7 |
  | VR-6 | Data retention requirements (minimum periods per record type, disposal) | Q-ARC-3, Q-ARC-5 | R12.9, R22.4 |
  | VR-7 | Privacy / data protection (customer IDs & names, staff data, access, masking, retention) | Q-DSC-3, Q-ORD-5, Q-ARC-3 | R2.7, R5.7, R12.9 |
  | VR-8 | Refund / consumer-protection documentation | Q-REF-2 | R10.8 |

- **R23.5 Statutory rules** in `compliance.statutory_rules` are disabled by default and cannot be enabled without recorded verification metadata (who verified, when, and the reference relied upon); an attempt without it is rejected (422 VALIDATION_ERROR).
- **R23.6** Compliance settings changes require ✱settings.compliance (Admin-only until Q-SET-3), are versioned and audited, and never rewrite issued documents or frozen orders.
