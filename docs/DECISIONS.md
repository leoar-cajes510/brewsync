# BrewSync — Business Rule Decision Register

> **Status: Phase 3B (2026-09-27).** Phase 3A created this sheet as a list of open questions. Phase 3B records the **owner-approved decisions** and the approved system rules. **This file is the source of truth for decision status.** Other documents link here ([DECISIONS.md](DECISIONS.md)); SYSTEM-LOGIC §9 is only a summary.
>
> Source documents: [SYSTEM-LOGIC.md](SYSTEM-LOGIC.md) · [BUSINESS-RULES.md](BUSINESS-RULES.md) · [USER-FLOWS.md](USER-FLOWS.md) · [PERMISSIONS.md](PERMISSIONS.md) · [DATABASE.md](DATABASE.md) · [API.md](API.md).
>
> Markers: **★** high priority (blocks core implementation) · **⚖** requires legal/business verification before production (see §14, VR-IDs) · **⚠ OPEN** not decided · **✅ DECIDED** owner-approved · ✱ permission · ⚑ feature gate.
>
> **Nothing in this register is a legal statement.** No field, rate, period, rounding step or document type is claimed to be legally mandatory, and no BIR/legal compliance is claimed. Every legal dependency is marked ⚖ with its VR-ID.
>
> **Option letters:** the owner brief records decisions as letters (e.g. "Q-ORD-1 = B"). Those letters do **not** map to the Phase 3A option lists in this sheet. The **approved wording** is authoritative; decisions are never described by their letter alone.
>
> How to record a further decision: replace the entry's "Decision: ⚠ OPEN" line with "Decision: DECIDED — date (who)", state the approved rule, then update the referenced sections in the other documents and remove their ⚠ OPEN markers.

---

## ID crosswalk (Phase 3B)

The owner brief reuses some Phase 3A IDs for different questions. From Phase 3B the brief's IDs are canonical; the conflicting Phase 3A questions are renumbered. All documents use the **new** IDs.

| Phase 3A ID (old meaning) | Canonical Phase 3B ID | Status |
|---|---|---|
| Q-AUTH-4 First Admin creation | **Q-AUTH-1** First-run setup wizard | ✅ DECIDED |
| Q-AUTH-1 Password or PIN | **Q-AUTH-2** Flexible authentication | ✅ DECIDED |
| Q-AUTH-2 Idle lock / session timeout | **Q-AUTH-4** Idle session timeout | ✅ DECIDED |
| Q-AUTH-2 sub-question "same user on two terminals at once?" | **Q-AUTH-6** Concurrent sessions per user | ⚠ OPEN (new ID) |
| (C-1 password policy values) | **Q-AUTH-7** Credential policy values | ⚠ OPEN (new) |
| Q-OFF-1 Must POS work offline? | **Q-TRM-2** Limited offline operation | ✅ DECIDED |
| Q-TRM-2 Staff restricted to assigned terminal? | **Q-TRM-6** | ⚠ OPEN (renumbered) |
| Q-TAX-3 Tax before/after discount | **Q-TAX-2** Tax after qualifying discount | ✅ DECIDED |
| Q-TAX-2 Tax rounding point | **Q-TAX-3** Rounding policy (2 dp, one server-side policy) | ✅ DECIDED |
| — | **Q-TRM-3, Q-TRM-4, Q-TRM-5, Q-ARC-4, Q-REF-4** | ✅ DECIDED (new IDs) |
| Q-OFF-1 | retired (use Q-TRM-2) | — |

All other Phase 3A IDs keep their number and meaning. External notes written before Phase 3B may still use the old IDs (risk AR-19).

## Current project status

- All **27 UI routes are implemented**, including **Settings → Receipts** (complete: printed/digital format, receipt logo, header toggles, transaction-information toggles, heading / thank-you / footer / small-print texts).
- POS, Orders, Receipts, History and Admin Overview display **temporary demo data** (`*MockData.ts`); Analytics (opt-in) and Archived Orders (dev-only) have sample generators. All of it is temporary and must be removed or replaced with live backend data in the integration phase (SR-10; list in SYSTEM-LOGIC §8).
- All settings and admin lists are **temporary in-memory state**; nothing persists.
- The backend (database, API, authentication) and the Python business logic are **not implemented**. Only `GET /health` exists.
- Some UI behaviour no longer matches decided rules (pay-first POS, single full payment, full-only refunds, per-discount "Tax Handling", `RESTORE_WINDOW_HOURS = 48`, fixed terminal list, no PIN/activation/setup-wizard screens, no security/archiving/offline/compliance settings screens, no ID-capture fields, no offline or cash-rounding UI). It is **not changed** in Phase 3B; it is revised in a later UI/integration phase (AR-20).
- **Phase 3B changed documentation only.** No code, tables, migrations or UI were changed.

## Fresh system rule

Approved and binding (SR-9). A production installation must **not** contain fake business data. Production initialization seeds **only**: roles, the permission catalogue, default role grants, default settings documents with neutral values (tax disabled, no rate), sequences and a default neutral document series at their start values, and `system_state.setup_status = not_started`.

The **business row and the first Admin are not seeded** — the owner creates them in the first-run setup wizard (**Q-AUTH-1**). No default or shipped password exists. Never seeded: products, categories, choices, ingredients, inventory, orders, payments, documents, expenses, customers, discounts, analytics, fake staff. Demo/sample data is development-only and must be excluded from production builds. (BUSINESS-RULES §18, DATABASE fresh-system section.)

---

## 1. ORDER FLOW

### Q-ORD-1 ★ Order first, pay later — ✅ DECIDED
- **Approved rule:** Order First, Pay Later. Workflow: POS → Order Created → Pending → Preparing → Ready for Pickup → Payment → Completed. Unpaid orders may exist before payment.
- **Implementation consequences:** unpaid orders are valid active orders; `orders.payment_status` (`unpaid` · `partially_paid` · `paid`, server-derived) is tracked separately from `orders.status` (`pending` · `preparing` · `ready` "Ready for Pickup" · `completed` · `cancelled`). Completion requires full settlement (Q-PAY-1; 409 ORDER_NOT_SETTLED). Payments may be recorded at any point between creation and completion; the canonical flow collects payment at Ready for Pickup (I-2). Order creation is `POST /orders` (create + reserve), payments are separate (`POST /orders/{id}/payments`). The current POS UI charges at checkout (pay-first) — to be changed in a later UI phase (C-7).
- **Remaining open detail:** whether the POS also offers "pay now" at order creation → **Q-ORD-6**.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-ORD-2 Can an order be edited after it is placed?
- **Why it matters:** Editing changes totals, reservations (Q-INV-2), tax and possibly payments already recorded; with pay-later, an order may be partially paid when an edit is requested. `pos.editOrders` exists as a permission but has no defined scope.
- **Options:** (a) Never — cancel and re-create. (b) Editable until Preparing starts. (c) Editable until Completed, with re-pricing and reservation adjustment. (d) Only by Admin.
- **Implementation needs:** last editable status; whether orders with completed payments can be edited and how a balance change is settled (new payment / refund-like return — see Q-CAN-1); reservation delta handling under SR-3 locks; `version` check; audit. `PATCH /orders/{id}` is not implemented until decided.
- Interim safe behaviour — not a decision: items are read-only once the order exists (BUSINESS-RULES §1).
- **Decision:** ⚠ OPEN

### Q-ORD-3 Do all order types use the same status steps?
- **Why it matters:** "Ready for Pickup" fits takeout; dine-in may end at "Served" and delivery at "Dispatched/Delivered".
- **Options:** (a) One flow for all types (Pending → Preparing → Ready → Completed). (b) Per-type final step labels only. (c) Per-type different status sets.
- **Implementation needs:** status set/labels per order type; board columns; analytics timing points; the canonical status values of Q-ORD-1 stay the base.
- **Decision:** ⚠ OPEN

### Q-ORD-4 Is a table number / delivery reference required?
- **Why it matters:** The POS/Orders UI shows a tag (table or delivery reference) but no setting makes it required (BUSINESS-RULES §2).
- **Options:** (a) Always optional. (b) Required for dine-in. (c) Required for delivery. (d) Configurable in Settings.
- **Implementation needs:** validation rule per order type; whether a Settings control is needed.
- **Decision:** ⚠ OPEN

### Q-ORD-5 ⚖ Is a customer name/record kept on orders?
- **Why it matters:** Receipts settings has "Show Customer Information"; demo data shows customer names. There is no customer entity, and customer data carries privacy obligations. (Identification captured for a discount under Q-DSC-3 is separate and stored on the discount snapshot.)
- **Options:** (a) No customer data. (b) Optional free-text name per order. (c) Customer records (profile, contact) reused across orders.
- **Implementation needs:** whether a Customer entity exists; access, masking, retention and privacy handling. ⚖ VR-7.
- **Decision:** ⚠ OPEN

### Q-ORD-6 POS "pay now" at order creation *(new in Phase 3B)*
- **Why it matters:** Q-ORD-1 makes pay-later the canonical flow, but the architecture permits recording payment at any time before completion. Whether the POS screen offers an immediate payment step changes the POS UI flow and counter speed.
- **Options:** (a) POS always creates an unpaid order; payment is taken later (e.g. from Orders at Ready for Pickup). (b) POS offers an optional "pay now" step right after the order is created. (c) Configurable per business or per order type.
- **Implementation needs:** POS UI flow only — the backend already supports payments at any point between creation and completion; whether a Settings control is needed; the sales document is still issued only at full settlement (I-9).
- **Decision:** ⚠ OPEN

## 2. INVENTORY

### Q-INV-1 ★ Product stock and ingredient stock — ✅ DECIDED
- **Approved rule:** Support BOTH product stock and ingredient stock. A product may have sellable product stock, ingredient recipe consumption, or both.
- **Implementation consequences:** two independent product flags `track_units` (sellable unit stock) and `track_ingredients` (recipe consumption) — either, both or neither; they replace the old `stock_mode` enum (C-16). When both are set, **both** must be sufficient. POS availability = min(unit availability, ingredient-limited availability). Stock lives in `stock_levels` (subject_type, subject_id, on_hand, reserved, low_stock_threshold). Feature gates: ⚑Inventory (units) and ⚑Ingredient Tracking (ingredients).
- **Remaining open detail:** behaviour while a tracking feature is disabled → **Q-FEAT-1**; choice-option ingredient modifiers → **Q-ING-2**.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-INV-2 ★ Reserve inventory at order creation — ✅ DECIDED
- **Approved rule:** Reserve/deduct inventory when an order is created. If the order is cancelled before completion, restore the reservation. When completed, the reservation becomes the finalized sale.
- **Implementation consequences:** creating an order reserves all required unit and ingredient stock atomically (all-or-nothing). Every stock subject has `on_hand` and `reserved`; `available = on_hand − reserved` (I-3). Movements: create → `reservation` (reserved +q) · cancel before completion → `reservation_release` (reserved −q) · complete → `sale` (on_hand −q and reserved −q). Abandoned unpaid orders hold stock until handled (AR-10: stale-unpaid-order alert/review; no auto-cancel decided).
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-INV-3 ★ Negative stock not allowed — ✅ DECIDED
- **Approved rule:** Negative stock is NOT allowed. The backend must prevent a sale from consuming unavailable stock. Inventory operations must be transactional and safe for concurrent terminals.
- **Implementation consequences:** invariants on_hand ≥ 0, reserved ≥ 0, reserved ≤ on_hand (available ≥ 0). A reservation exceeding available is rejected (409 INSUFFICIENT_STOCK with offending items). A manual adjustment may not reduce on_hand below reserved (409 STOCK_RESERVED; AR-11). Adjustments are rejected, never clamped — the current UI clamps to 0 (temporary). All stock changes follow SR-3 (one transaction, deterministic row locks, conditional updates, DB check constraints as last defence).
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-INV-4 Default low-stock threshold source
- **Why it matters:** Settings → Staffing has *Low Stock Threshold* (default 10), while the product catalogue code uses a separate default of 5 for new stock records (C-4).
- **Options:** (a) Staffing value is the default for every new product/ingredient. (b) Staffing value is a global threshold overriding per-item values. (c) Per-item only; Staffing value unused.
- **Implementation needs:** which value applies to `stock_levels.low_stock_threshold` when an item has none; `stock.low` event rule.
- **Approved rule:** (a) — Settings → Staffing → Low Stock Threshold is the **default** threshold pre-filled for newly created products and ingredients. Existing per-item thresholds remain authoritative; the Staffing value is never a global override and changing it does not alter existing items.
- **Decision:** DECIDED — 2026-10-04 (owner approval).

### Q-ING-2 Do choice options consume ingredients?
- **Why it matters:** "Oat Milk", "Extra Shot", or larger sizes change ingredient usage and cost — and now also the ingredient **reservation** made at order creation (Q-INV-2).
- **Options:** (a) No — recipes are per product only. (b) Options add fixed ingredient quantities. (c) Options multiply the base recipe (e.g. size factor). (d) Both (b) and (c).
- **Implementation needs:** option→ingredient modifier model; consumption/reservation formula; POS availability computation.
- **Decision:** ⚠ OPEN

### Q-ING-3 Ingredient costing method
- **Why it matters:** Drives cost of goods and estimated profit in Analytics.
- **Options:** (a) Current unit cost. (b) Weighted average cost. (c) FIFO. (d) Cost at time of each restock without averaging.
- **Implementation needs:** whether restocks record unit cost; how COGS is computed at sale.
- **Decision:** ⚠ OPEN

### Q-ING-4 Unit conversion in recipes
- **Why it matters:** Ingredients can be stocked in kg/L but used in g/ml.
- **Options:** (a) Recipe must use the ingredient's own unit. (b) Automatic conversion within the same dimension (mass, volume). (c) Custom conversion factors (e.g. "1 bag = 5 kg").
- **Implementation needs:** conversion table; validation of recipe units.
- **Decision:** ⚠ OPEN

## 3. PAYMENTS

### Q-PAY-1 ★ Split payments — ✅ DECIDED
- **Approved rule:** Split payments are allowed (e.g. total ₱500 — Cash ₱300 — GCash ₱200). Payments must be individually recorded. An order cannot be completed until the required amount has been fully settled. Cash: calculate change automatically. GCash/Card/Bank Transfer: require a payment reference where configured.
- **Implementation consequences:** each payment is a separate immutable record (`payments`: amount, tendered, change_given, rounding_adjustment, reference, status, confirmed_by/at, idempotency_key, origin). Only `completed` payments count toward settlement; settlement condition: Σ over completed payments of (`amount` + `rounding_adjustment`) = order `total`. New payments are limited to the remaining balance (total − completed − pending) → 422 OVERPAYMENT. Cash: `tendered` ≥ `amount` (422 INSUFFICIENT_TENDER), `change_given = tendered − amount`, computed by the server. Non-cash: exact amount; reference required when the method's `require_reference` is on (422 REFERENCE_REQUIRED). Completed payments are never edited — reversal only through a refund. Pending payments can be voided. Idempotency-Key and an order row lock prevent duplicate capture (SR-3, AR-15).
- **Remaining open detail:** meaning of payment confirmation → **Q-PAY-3**; additional methods → **Q-PAY-4**.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-PAY-2 Cash rounding configurable at business level — ✅ DECIDED
- **Approved rule:** Cash rounding is configurable at the business level. Cash: rounding may be enabled/disabled according to business configuration. Non-cash: use the exact calculated amount. The rounding rule itself must be configurable/documented.
- **Implementation consequences:** setting `payments.cash_rounding = { enabled, increment, mode }` (mode: nearest / down / up). Applied **only** to a cash payment that settles the full remaining balance while rounding is enabled; non-cash and partial cash payments use the exact amount. `rounding_adjustment = remaining − collected` is stored explicitly on the payment (never hidden in totals); the order total is not changed; the document shows the rounding line per display/compliance settings. Increment and mode values are configuration, not facts. No cash-rounding UI yet.
- **Remaining open detail:** default values → **Q-SET-4**.
- **⚖** VR-5.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-PAY-3 ★ What does "payment confirmation" mean?
- **Why it matters:** Settings → Payments has "Require payment confirmation" for GCash/Card/Bank Transfer without a defined procedure. With split payments, a `pending` payment blocks part of the remaining balance (it counts against new payments) but does not count toward settlement, so an unconfirmed payment blocks completion.
- **Options:** (a) Cashier ticks a confirmation checkbox. (b) A second person/Admin confirms. (c) Confirmed later from a pending list.
- **Implementation needs:** who confirms (cashier, second person or Admin) — `POST /payments/{id}/confirm` requires ✱pos.processPayments (ledger clarification; a stricter rule may be added by this decision); `confirmed_by`/`confirmed_at`; whether orders proceed through preparation while a payment is pending; void of pending payments (`POST /payments/{id}/void`); real-time `payment.confirmed` / `payment.voided`.
- **Decision:** ⚠ OPEN

### Q-PAY-4 Payment methods outside Cash/GCash/Card/Bank Transfer
- **Why it matters:** Expenses allow an "Other" method; sales payments do not. Future e-wallets or vouchers are unspecified.
- **Options:** (a) Fixed four methods for sales (`cash` · `gcash` · `card` · `bank_transfer`). (b) Business-defined custom methods. (c) Add specific methods later case by case.
- **Implementation needs:** enum vs table for payment methods; offline availability (offline is cash-only, Q-TRM-4).
- **Decision:** ⚠ OPEN

## 4. REFUNDS

### Q-REF-4 Refunds controlled by a business feature toggle — ✅ DECIDED *(new ID)*
- **Approved rule:** Refunds are controlled by a business feature toggle. Refunds ON → authorized users may process refunds. Refunds OFF → refund actions are unavailable.
- **Implementation consequences:** the toggle is Settings → Features → Refunds (already in the UI). ON → users with ✱pos.processRefunds may refund. OFF → refund endpoints return 403 FEATURE_DISABLED and the UI hides refund actions. Historical refunds stay visible either way. Interaction with cancelling a paid order → Q-CAN-1 (C-19, AR-14).
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-REF-1 ★ Full and partial refunds — ✅ DECIDED
- **Approved rule:** Support full refunds and partial refunds. Refunds require appropriate authorization. Completed transaction history must never be silently overwritten. Refunds must be represented as separate financial records linked to the original transaction.
- **Implementation consequences:** each refund is a separate immutable record linked to the original order, its sales document and the payment(s) it returns (`refunds`, `refund_lines`, `refund_allocations`). The server computes the refund amount; Σ refunds ≤ Σ completed payment `amount` (422 REFUND_EXCEEDS_REFUNDABLE). The original order, payments and document snapshot are never edited; `orders.refund_status` (`none` · `partially_refunded` · `refunded`) and document status are updated. Requires ✱pos.processRefunds (protected) and ⚑Refunds (Q-REF-4); Idempotency-Key required. Refunds apply to **completed** orders (I-14). Resolves C-6 (UI adds partial refunds later).
- **Remaining open detail:** partial refund granularity → **Q-REF-5**; method, time limit and allocation across split payments → **Q-REF-2**; restock → **Q-REF-3**; extra Admin approval → **Q-DSC-4 / Q-AUTH-3**; money returned on a paid-but-not-completed order → **Q-CAN-1**.
- **⚖** VR-3 (refund document numbering/type).
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-REF-2 ★ ⚖ Refund method, time limit and allocation across split payments
- **Why it matters:** Cash-out control and fraud risk. With split payments, a refund must be allocated to one or more original payments (`refund_allocations`).
- **Options:** Method — (a) same as original payment(s), (b) always cash, (c) chosen at refund. Time limit — (a) none, (b) same day/shift, (c) N days. Allocation — (a) proportional to original payments, (b) cash first, (c) chosen by the user, (d) reverse order of capture.
- **Implementation needs:** validation at refund time; allocation rule per payment; refund availability offline (not available — Q-TRM-3). ⚖ VR-8 (refund / consumer-protection documentation).
- **Decision:** ⚠ OPEN

### Q-REF-3 Are refunded items returned to stock?
- **Options:** (a) Never. (b) Always. (c) Chosen per refund. (d) Per product type (e.g. packaged goods only).
- **Implementation needs:** whether a refund writes `sale_reversal` movements (on_hand +q, reference_type `refund`); interaction with partial refund granularity (Q-REF-5).
- **Decision:** ⚠ OPEN

### Q-REF-5 ★ Partial refund granularity *(new in Phase 3B)*
- **Why it matters:** Q-REF-1 approves partial refunds but not how "partial" is defined. It determines the refund line model, how tax and the order discount are apportioned to the refunded part, and whether restock (Q-REF-3) can be tied to lines.
- **Options:** (a) By line and quantity only. (b) Arbitrary amount only. (c) Both.
- **Implementation needs:** `refund_lines` content; server computation of the refundable amount per line (share of the pro-rata discount allocation and tax, Q-TAX-2) or per amount; rounding points (Q-TAX-3); document status transitions (`partially_refunded` / `refunded`).
- **Decision:** ⚠ OPEN

### Q-CAN-1 ★ Cancelling a paid or partially paid order
- **Why it matters:** With pay-later (Q-ORD-1) and split payments (Q-PAY-1), an order that is not yet completed may already have one or more completed payments. Cancelling it means returning money, but refunds apply to completed orders (Q-REF-1) and may be switched off (Q-REF-4) — so such an order could get stuck (C-19, AR-14). No sales document exists yet if the order was not fully settled (I-9).
- **Options:** (a) Not allowed while any completed payment exists — the order must be completed and then refunded. (b) Allowed with an automatic full return of all completed payments in the same transaction, recorded as refund records, only when Refunds is ON. (c) Allowed with an automatic full return regardless of the Refunds toggle (the return is part of cancellation, not a refund action). (d) Allowed only by Admin.
- **Implementation needs:** cancellation→refund/return linkage across split payments; permission (`pos.cancelOrders` vs `pos.processRefunds`); behaviour when Refunds is OFF; voiding pending payments on cancel; `reservation_release`; document status if a document exists; audit (SR-7).
- **Decision:** ⚠ OPEN

## 5. DISCOUNTS

### Q-DSC-1 ★ One discount per order — ✅ DECIDED
- **Approved rule:** Only ONE discount may apply to an order. Discount stacking is prohibited.
- **Implementation consequences:** at most one `order_discounts` row per order (unique); a second one → 409 DISCOUNT_ALREADY_APPLIED. Per-item discounts are not supported. A statutory layer (Q-DSC-2) may interact with this rule — verify before enabling (AR-17).
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-DSC-2 ★ Senior Citizen / PWD through the normal configurable discount system — ✅ DECIDED
- **Approved rule:** Senior Citizen and PWD discounts are represented through the normal configurable discount system. Any legal/tax treatment for Senior Citizen/PWD transactions must be implemented as a separate configurable/compliance rule and verified against applicable Philippine requirements before production use. Statutory treatment is handled separately from ordinary discount logic where required.
- **Implementation consequences:** ordinary discount definitions with eligibility `senior` / `pwd`. Any statutory treatment is a **separate** configurable compliance rule (`compliance.statutory_rules`, disabled by default, carries verification metadata) that plugs into the pricing pipeline through a dedicated policy (SYSTEM-LOGIC §13). No statutory formula is defined in these documents.
- **⚖** VR-1.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-DSC-3 Identification capture when configured — ✅ DECIDED
- **Approved rule:** When a Senior Citizen/PWD discount is configured to require identification details, the POS must support recording appropriate customer identification information such as customer name, ID type and ID number. No specific field is claimed to be legally mandatory unless separately verified.
- **Implementation consequences:** each discount definition has `requires_identification` (bool) and `identification_fields` (subset of: customer name, ID type, ID number) — configurable per discount (I-13). When set, the POS records those details on the order's discount snapshot (`order_discounts` customer_name, id_type, id_number); the server rejects a missing value with 422 IDENTIFICATION_REQUIRED. Treated as personal data: stored only when required, visible only to authorized roles, masked in lists, never in real-time events; printing on documents is a compliance setting. The audit log records the capture event, not the ID value. No ID-capture UI yet.
- **⚖** VR-2, VR-7.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-DSC-4 Does applying a discount need Admin approval?
- **Why it matters:** Discount abuse control; the same approval mechanism may be needed for refunds (Q-REF-1).
- **Options:** (a) `pos.applyDiscounts` permission is enough. (b) Admin approval for all discounts by re-entering an Admin password (Admins cannot use a PIN, Q-AUTH-2; C-20). (c) Approval only above a threshold or for certain types (e.g. ID-capture discounts).
- **Implementation needs:** approval flow and `approved_by` recording; relation to Admin Mode (Q-AUTH-3); audit of discount authorization (SR-7).
- **Decision:** ⚠ OPEN

## 6. TAX

### Q-TAX-1 Taxability per product — ✅ DECIDED
- **Approved rule:** Taxability is configurable per product/menu item. Philippine tax rates must not be hard-coded as permanent production values; tax settings remain configurable.
- **Implementation consequences:** `products.tax_class` (baseline values `taxable`, `non_taxable`). One configured tax in Settings → Tax (enabled, name, rate, mode included/excluded, registration number, display flags); the rate is configuration; default: tax disabled, empty rate. Any further classes (e.g. exempt vs zero-rated) are compliance configuration. The POS mock `MOCK_VAT_RATE = 0.12` is temporary UI data and must be replaced by settings.
- **⚖** VR-4.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-TAX-2 Tax after the ordinary discount — ✅ DECIDED *(formerly Q-TAX-3)*
- **Approved rule:** For ordinary discounts, tax is calculated after the qualifying discount. Senior Citizen/PWD statutory treatment is handled separately (Q-DSC-2).
- **Implementation consequences:** pipeline: line totals → subtotal → the one discount (computed on the listed prices; percentage/fixed, min order, cap) → discount allocated pro-rata across eligible lines by line amount, largest-remainder so allocations sum exactly (I-6, I-7) → tax computed once per order per tax class on the discounted taxable amount (included: tax = T − T ÷ (1+r); excluded: tax = T × r) → total. The per-discount "Tax Handling" (Before Tax / After Tax / Not Applicable) control in the Discounts UI is superseded for ordinary discounts and removed from the backend discount model (C-12). Pro-rata allocation across taxable/non-taxable lines is a technical rule (AR-18).
- **⚖** VR-4.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-TAX-3 Rounding policy — ✅ DECIDED *(formerly Q-TAX-2)*
- **Approved rule:** Monetary calculations are rounded to 2 decimal places using one consistent server-side rounding policy.
- **Implementation consequences:** all money is decimal with 2 dp. One policy in the server Money module: half-up to 0.01 (I-8) at defined points only — line total, discount amount and its allocation, tax per order per tax class, total, change, refund amount, cash rounding. The client never rounds authoritative values (SR-8). If a prescribed method is verified to apply, it replaces the policy in one place.
- **⚖** VR-4.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

## 7. RECEIPTS / SALES DOCUMENTS

The neutral term is **sales document** (UI label "Receipt"). "Official Receipt" is **not** assumed to be the primary sales document.

### Q-RCP-1 Separate identifiers, configurable formatting, reprint — ✅ DECIDED
- **Approved rule:** Use separate internal identifiers: Order Number and Receipt/Document Number. Receipt/document formatting must be configurable. Reprinting must retain the original document number and increment a reprint count/audit record rather than generating a new transaction.
- **Implementation consequences:** order number (`orders.number`, operational business sequence; gaps from rolled-back transactions acceptable) and sales document number (`documents.number`, from a `document_series`) are separate (C-14). Formatting = Settings → Receipts (display only; complete in the UI). Reprint (`POST /documents/{id}/reprint`, ✱receipts.reprint) keeps the original number, increments `print_count`, writes a `document_prints` row and an audit record, and never creates a new transaction or number. Mandatory content is not decided here (compliance settings).
- **Remaining open detail:** paper width(s) for printed documents and logo printing on thermal paper → **Q-ARCH-4** / **Q-RCP-4**.
- **⚖** VR-3.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-RCP-2 ★ Compliance-ready document architecture — ✅ DECIDED
- **Approved rule:** The architecture must be compliance-ready for Philippine invoicing/document requirements. Automatic BIR compliance is not claimed. Compliance-specific settings stay configurable and separate from ordinary POS display settings. "Official Receipt" is not permanently assumed to be the primary sales document.
- **Implementation consequences:** document types (`documents.document_type`: `sales` · `refund`), titles, series (format template, scope business or terminal, start number, optional allocated ranges, reset policy), "must print" field locks and reprint marker text live in the separate `compliance` settings section — not in `receipts`. Field locks override display toggles when set (C-3). Numbers are allocated inside the issuing transaction with a row lock, gap-free within a series as a technical design goal. Document statuses: `issued` · `partially_refunded` · `refunded` · `void` (void only if verified rules allow).
- **⚖** VR-3.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-RCP-3 ⚖ Pre-payment order slip / bill
- **Why it matters:** Narrowed in Phase 3B: the sales document is issued at full settlement (I-9). The remaining question is only whether a **pre-payment** slip or bill (not a sales document) is printed for unpaid orders — e.g. for the kitchen or for the customer to check before paying.
- **Options:** (a) No pre-payment document. (b) Optional order slip/bill printed on request. (c) Automatic slip at order creation.
- **Implementation needs:** whether the slip is stored/numbered (it must not use a sales document series); wording that makes clear it is not a sales document; printing path (Q-ARCH-4). ⚖ VR-3 (whether any pre-payment document has requirements).
- **Decision:** ⚠ OPEN

### Q-RCP-4 Which logo prints on sales documents?
- **Why it matters:** Settings → Branding has a business logo; Settings → Receipts has its own receipt logo upload (C-2).
- **Options:** (a) Receipt-specific logo only. (b) Branding logo only. (c) Receipt logo, falling back to Branding logo.
- **Implementation needs:** which settings field the document renderer reads; storage (Q-ARCH-2); thermal printing (Q-ARCH-4).
- **Decision:** ⚠ OPEN

### Q-RCP-5 ★ ⚖ Offline sales document numbering *(new in Phase 3B)*
- **Why it matters:** Sales document numbers are allocated centrally, gap-free within a series; an offline terminal cannot reach the allocator (AR-2). Offline cash sales are allowed (Q-TRM-3/Q-TRM-4).
- **Options:** (a) No sales document offline — a provisional slip is printed and the sales document is issued when the transaction is committed at sync. (b) Per-terminal pre-allocated number ranges usable offline. (c) A terminal-scoped series (`document_series` scope terminal).
- **Implementation needs:** `document_series` scope and allocated ranges; handling of unused/abandoned ranges and gaps; what the provisional slip shows; reprint of the synced document. ⚖ VR-3.
- Interim safe behaviour — not a decision: until resolved, an offline sale prints only a provisional slip that is not a sales document; the sales document is issued when the transaction is committed at sync (SR-4).
- **Decision:** ⚠ OPEN

## 8. ARCHIVING, RETENTION & DELETION

### Q-ARC-1 ★ Automatic and manual archival — ✅ DECIDED
- **Approved rule:** Support automatic archival and manual Admin archival.
- **Implementation consequences:** see Q-ARC-4 for which orders use which path. Archive is a flag (`archived_at`), not a status, and never deletes. Manual archive and restore require ✱archive.manage (gap key, Admin-only until Q-SET-3). Replaces the Phase 3A interim "manual archive by Admin only" (C-9).
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-ARC-4 Completed → automatic; cancelled → manual — ✅ DECIDED *(new ID)*
- **Approved rule:** Completed orders are archived automatically according to the configured archival timing. Cancelled orders remain available for Admin review and are manually archived.
- **Implementation consequences:** a server-side scheduled job archives `completed` orders once `completed_at + archiving.auto_archive_after` has passed (business timezone; system actor; audited; no endpoint). Cancelled orders are never auto-archived; they stay in an Admin review list until an Admin archives them manually (`POST /archive`, reason required). Admin may also archive completed orders manually before the automatic timing. A restored order is excluded from automatic re-archiving; manual re-archive is allowed (I-11, AR-13).
- **Remaining open detail:** default `auto_archive_after` → **Q-SET-4**.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-ARC-2 ★ Configurable restore window; Admin only — ✅ DECIDED
- **Approved rule:** The restore window is configurable. Only authorized Admin users may restore archived orders.
- **Implementation consequences:** setting `archiving.restore_window`; restore via `POST /archive/{order_id}/restore` (✱archive.manage); outside the window → 409 RESTORE_WINDOW_EXPIRED. Restored completed orders return to History, never to the active board (existing rule kept). The UI constant `RESTORE_WINDOW_HOURS = 48` is a temporary placeholder (C-10).
- **Remaining open detail:** default window → **Q-SET-4**.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-ARC-3 Configurable retention, never below the legal minimum — ✅ DECIDED
- **Approved rule:** Data retention is configurable but must not allow a retention period below the applicable legal minimum. Where applicable requirements demand longer retention, records must be retained longer. No legal retention period is invented.
- **Implementation consequences:** `archiving.retention_period` (business) must be ≥ `compliance.retention_minimum`, which is entered only after verification; lower values → 422 RETENTION_BELOW_MINIMUM. Where requirements demand longer, the longer period applies. **Until a verified minimum is configured, nothing is disposed** (I-12, C-18). No legal period is stated anywhere in these documents. Retention configuration is audited.
- **Remaining open detail:** end-of-retention handling → **Q-ARC-5**; default value → **Q-SET-4**.
- **⚖** VR-6, VR-7.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-ARC-5 ⚖ End-of-retention handling *(new in Phase 3B)*
- **Why it matters:** History preservation (SR-6) forbids hard deletion of operational records, while retention (Q-ARC-3) implies records may eventually leave the system (C-18, AR-12).
- **Options:** (a) Keep indefinitely. (b) Export, then purge. (c) Anonymize personal data (e.g. identification details, customer names) while keeping financial records.
- **Implementation needs:** per-record-type handling; export format; how audit logs, documents and stock movements are treated; interaction with SR-6. ⚖ VR-6, VR-7.
- **Decision:** ⚠ OPEN

### Q-DEL-1 Configuration objects: hard delete only if never referenced — ✅ DECIDED
- **Approved rule:** (from the approved SOFT DELETE / HISTORY rule) Products, ingredients, choices, staff accounts and similar configuration objects use inactive/archive/soft-delete behaviour when historical references exist.
- **Implementation consequences:** hard delete only if never referenced; otherwise deactivate/archive. Applies to products, categories, ingredients, choice groups/options, discounts, staff accounts, terminals. Operational records are never hard-deleted (SR-6).
- **Remaining open detail:** expenses → **Q-EXP-1**.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-EXP-1 Can expenses be deleted?
- **Why it matters:** The current UI deletes expenses. The approved principle "operational records that affect history must not be hard-deleted" points to void-with-reason; confirmation needed.
- **Options:** (a) Delete allowed (current UI). (b) Void only, with reason. (c) Delete only same day, void afterwards.
- **Implementation needs:** expense lifecycle; analytics excludes void expenses; audit.
- **Decision:** ⚠ OPEN

## 9. AUTHENTICATION

### Q-AUTH-1 ★ First-run setup wizard — ✅ DECIDED *(formerly Q-AUTH-4)*
- **Approved rule:** A fresh BrewSync installation uses a first-run setup wizard: Fresh Installation → Business Setup → Create First Admin → Complete Setup → Login. No permanent default password is shipped.
- **Implementation consequences:** `system_state.setup_status` (`not_started` · `in_progress` · `completed`). Before completion only `/setup/*` and `/health` work (others → 409 SETUP_REQUIRED); after completion `/setup/*` permanently return 409 SETUP_ALREADY_COMPLETED — except read-only `GET /setup/status`, which always answers (reports `completed`) so a device can choose between the wizard and Login (C-23). Endpoints: `GET /setup/status` · `POST /setup/business` · `POST /setup/admin` · `POST /setup/complete`. Complete Setup is one atomic transaction (business row + first Admin + setup completed + audit). The owner chooses the Admin password. No setup-wizard UI yet.
- **Remaining open detail:** credential policy → **Q-AUTH-7**; wizard protection on a network-reachable fresh install → **Q-AUTH-8**; first device / terminal → **Q-TRM-8**.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-AUTH-2 ★ Flexible authentication — ✅ DECIDED *(formerly Q-AUTH-1)*
- **Approved rule:** Admin: Username + Password. Cashier: Username + PIN or Username + Password. The selected authentication method must be enforced by the backend.
- **Implementation consequences:** `users.auth_method` ∈ {`password`, `pin`}. Admin accounts must use `password` (`pin` → 422 AUTH_METHOD_NOT_ALLOWED). Cashier method is selected per account by an Admin in Staff (I-4). The server accepts only the account's selected method. Credentials hashed with a strong adaptive hash; failed attempts counted; lockout → 423 ACCOUNT_LOCKED; PIN sign-in only from an activated terminal (AR-9). `POST /staff/{id}/reset-credential` replaces reset-password. Resolves C-1 in principle (one server-enforced credential policy). Login has no PIN mode in the UI yet.
- **Remaining open detail:** length/complexity/lockout values → **Q-AUTH-7**.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-AUTH-4 ★ Configurable idle session timeout — ✅ DECIDED *(formerly Q-AUTH-2)*
- **Approved rule:** The idle session timeout is configurable; possible configured values may include 5, 10, 15, 30, 60 minutes. The backend/session layer must enforce the actual timeout.
- **Implementation consequences:** `security.idle_timeout_minutes`, business-wide (I-5), chosen from an allowed list (approved candidate values 5, 10, 15, 30, 60). The server stores `sessions.last_activity_at`, updates it on user-initiated requests only (not realtime heartbeats or background refresh), and ends a session idle longer than the timeout (end_reason `idle_timeout`, 401 SESSION_EXPIRED). The client timer is UX only. Offline enforcement is local only (AR-3).
- **Remaining open detail:** concurrent sessions → **Q-AUTH-6**; default value → **Q-SET-4**.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-AUTH-3 What is "Admin Mode / Lock Admin"?
- **Why it matters:** The Admin header shows "Admin Mode" and "Lock Admin"; mockups show "Admin Mode • Unlocked". The same mechanism may serve discount and refund approvals (Q-DSC-4, Q-REF-1).
- **Options:** (a) Purely role-based — Admins always have admin access. (b) Admin area requires re-entering credentials (elevation) and can be re-locked. (c) Admin override lets a Cashier session perform one protected action.
- **Implementation needs:** elevation token/flow; audit of overrides; landing page per role; relation to `sessions.end_reason` `lock`.
- **Decision:** ⚠ OPEN

### Q-AUTH-5 Can an Admin rename a user's username?
- **Why it matters:** BUSINESS-RULES §13 records this as an assumption (the Phase 3A wrong reference to Q-AUTH-1 is fixed).
- **Options:** (a) Username immutable. (b) Admin can rename. (c) User can rename.
- **Implementation needs:** uniqueness; audit; snapshots keep the historical name.
- Interim safe behaviour — not a decision: username immutable after creation.
- **Decision:** ⚠ OPEN

### Q-AUTH-6 Concurrent sessions per user *(new ID; formerly a Q-AUTH-2 sub-question)*
- **Why it matters:** Whether one user may be signed in on two terminals at once affects session control, auditing and offline sessions.
- **Options:** (a) Allowed. (b) One active session per user — a new sign-in ends the old one (end_reason `forced`). (c) One active session per user — a second sign-in is rejected. (d) Configurable.
- **Implementation needs:** session lookup at login; `session.started` / `session.ended` events; behaviour for offline sessions.
- **Decision:** ⚠ OPEN

### Q-AUTH-7 ★ Credential policy values *(new in Phase 3B)*
- **Why it matters:** Q-AUTH-2 requires one server-enforced credential policy, but no values are approved. Two different UI rule sets exist today (C-1: Staff 8+, letter, number vs Account 8+, number, uppercase). PIN sign-in on a shared device needs brute-force protection (AR-3, AR-9).
- **Options:** Password — (a) adopt one of the existing UI rule sets, (b) new values configured in `security` settings, (c) fixed values in the server. PIN — length (e.g. 4 or 6 digits, or configurable). Lockout — attempts threshold and duration (fixed vs configurable).
- **Implementation needs:** values stored with `security` settings or fixed; `failed_attempts`, `locked_until`, `must_change_credential` behaviour; temporary credential expiry after reset; offline cached verifiers (Q-TRM-7).
- **Decision:** ⚠ OPEN

### Q-AUTH-8 ★ Setup wizard protection on a fresh, network-reachable install *(new in Phase 3B)*
- **Why it matters:** Until setup is completed, anyone who can reach the server could run the wizard and create the first Admin (AR-8).
- **Options:** (a) Setup only reachable from the installation device/localhost. (b) One-time setup token generated at installation and required by the wizard. (c) Setup disabled until an installer flag is set. (d) Accept the risk on a trusted local network.
- **Implementation needs:** how `/setup/*` authorizes the caller; how the token/flag is delivered to the owner; audit of setup completion.
- **Decision:** ⚠ OPEN

## 10. TERMINALS & OFFLINE

### Q-TRM-1 ★ Admin registers, device activates — ✅ DECIDED
- **Approved rule:** Admin registers terminals first. Each physical device then claims/activates its assigned terminal during setup. A device should not freely claim arbitrary terminal identities.
- **Implementation consequences:** Admin creates a terminal (code, name) → server issues a one-time, short-lived activation code (shown once, stored hashed) → the device enters it (`POST /terminals/activate`; invalid → 400 ACTIVATION_CODE_INVALID) → server binds the device by issuing a device credential (secret kept on the device, hash stored) → terminal `active`. Terminal identity at login comes from the device credential (`X-Device-Credential`), never from a client-supplied code (403 TERMINAL_NOT_ACTIVATED otherwise). Admin can deactivate or reset activation (revokes the credential, issues a new code) — ✱terminals.manage (gap key). Staffing → Maximum Active Terminals enforced at activation/reactivation (409 LIMIT_REACHED). Statuses: `pending_activation` · `active` · `inactive` · `revoked`. Resolves C-11; the fixed UI list REG-01…03 is temporary. Browser-held credentials carry risk AR-7.
- **Remaining open detail:** staff restriction to assigned terminals → **Q-TRM-6**; first device / Admin access without a terminal → **Q-TRM-8**.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-TRM-2 Limited offline operation supported — ✅ DECIDED *(formerly Q-OFF-1)*
- **Approved rule:** Limited offline operation is supported.
- **Implementation consequences:** offline mode is a business setting `offline.enabled`. Offline clients follow SR-4 (sync protocol) and SR-5 (offline inventory); architecture in SYSTEM-LOGIC §12.
- **Remaining open detail:** default value → **Q-SET-4**; exact scope and limits → **Q-TRM-7**.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-TRM-3 Limited POS functionality offline — ✅ DECIDED *(new ID)*
- **Approved rule:** Offline mode supports LIMITED POS functionality.
- **Implementation consequences (baseline scope, I-10):**
  - Allowed: continue an already-authenticated session on an activated terminal; create orders from the last synchronized snapshot (`pos_snapshots`, per `catalog_version`); cash payments; local stock tracking that blocks sales when local available stock is insufficient; local status changes for orders created offline on that terminal; print a provisional slip.
  - Not available: GCash/Card/Bank Transfer; refunds; cancelling or paying orders created online; restock/adjustments; catalog, settings, staff and terminal changes; archive/restore; analytics; expenses; terminal activation.
  - Sales documents for offline sales: Q-RCP-5.
- **Remaining open detail:** discounts offline (especially ID-capture discounts), new sign-in while offline, reprint offline, offline limits (max duration / queued count / value), status changes on online orders, cancelling offline-created orders while offline → **Q-TRM-7**.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-TRM-4 Offline payments: cash only — ✅ DECIDED *(new ID)*
- **Approved rule:** Offline payments are CASH ONLY. GCash/Card/Bank Transfer are unavailable while offline.
- **Implementation consequences:** the offline POS offers only cash; the server re-validates cash-only for every offline submission at sync (SR-4).
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-TRM-5 Queued offline transactions; review threshold — ✅ DECIDED *(new ID)*
- **Approved rule:** Offline transactions may remain queued. If synchronization fails beyond a configurable threshold, the transaction is flagged for Admin review. Transactions are never silently lost or rewritten.
- **Implementation consequences:** queued transactions persist on the device until the server confirms them (AR-6). A transaction not committed within `offline.sync_review_threshold` (time since capture and/or failed attempts) is flagged `needs_review` for an Admin — server side when received/attempted (`offline_submissions.status`: `received` · `committed` · `needs_review` · `resolved`; event `sync.review_required`), device side as a warning. Admin reconciliation via `/sync/reviews` (✱sync.review, gap key), audited; the original submission is never modified. Nothing is silently lost, merged or rewritten.
- **Remaining open detail:** default threshold → **Q-SET-4**.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-TRM-6 Is a staff member restricted to their assigned terminal? *(formerly Q-TRM-2)*
- **Why it matters:** Terminals are now registered and activated (Q-TRM-1); the Staff UI has a default terminal and an "All Terminals" option.
- **Options:** (a) Default terminal is a preference only. (b) Staff may only sign in on assigned terminal(s). (c) "All Terminals" option per staff (present in the Staff UI) plus restriction otherwise.
- **Implementation needs:** login check against terminal assignment; assignment model (one vs many terminals per user).
- **Decision:** ⚠ OPEN

### Q-TRM-7 ★ Exact offline scope and limits *(new in Phase 3B)*
- **Why it matters:** The baseline (Q-TRM-3) leaves items to confirm. Offline actions cannot be enforced by the server at the time they happen (AR-1, AR-3, AR-4, AR-5).
- **Options (per item):** discounts offline — (a) none, (b) only discounts without identification, (c) all; new sign-in while offline — (a) not allowed, (b) allowed with cached verifiers; reprint offline — (a) no, (b) provisional slips only; limits — max offline duration, max queued count, max queued value (each: none / fixed / configurable in `offline` settings); status changes on online orders — (a) no, (b) yes, reconciled at sync; cancelling an order created offline while still offline — (a) no, (b) yes, reservation release reconciled at sync.
- **Implementation needs:** offline settings keys (limits); local enforcement; sync validation of each allowed action; conflict reasons for review.
- **Decision:** ⚠ OPEN

### Q-TRM-8 ★ First device / Admin access without a terminal *(new in Phase 3B)*
- **Why it matters:** After setup, the Admin must register terminals, but terminal activation needs an Admin and PIN sign-in needs an activated terminal. The first device's path is undefined.
- **Options:** (a) The setup device is registered and activated as the first terminal during setup. (b) Password-authenticated Admins may sign in from a non-terminal browser for back-office functions only; POS actions need an activated terminal. (c) The Admin activates the setup device in a separate step right after setup.
- **Implementation needs:** login rule for Admins without a device credential; which functions require a terminal; interaction with Maximum Active Terminals.
- Interim safe behaviour — not a decision: every sign-in, including Admin, requires an activated terminal (PERMISSIONS §1.2); this cannot bootstrap the first terminal, so Q-TRM-8 must be decided before setup/login/terminal endpoints are implemented.
- **Decision:** ⚠ OPEN

## 11. SETTINGS

### Q-SET-1 ★ Preferences are business-wide — ✅ DECIDED
- **Approved rule:** Preferences are BUSINESS-WIDE. Settings affecting operational behaviour are consistently applied across terminals/users. User-specific or terminal-specific security/session state remains separate from business preferences.
- **Implementation consequences:** one `preferences` document per business, applied on every terminal and user. Credentials, sessions, lock state and terminal activation are separate records, not preferences. All settings sections are business-wide, versioned (`settings_history`) and audited; changes emit `settings.changed`. Account is the caller's own user record, not a settings document.
- **Decision:** DECIDED — 2026-09-27 (Phase 3B owner approval).

### Q-SET-2 Overlapping controls between Features, Preferences, Tax and Receipts
- **Why it matters:** Several switches exist in two places (C-3, C-5): Features has Sound Effects, Live Updates, Low/Order Alerts; Preferences has Interface Sounds, Live Updates & Auto Refresh, Low Stock/Order alerts; Tax has "Show Tax on Receipt / Show Rate / Show Breakdown"; Receipts has "Show Tax". Both pages are now business-wide (Q-SET-1), which simplifies but does not remove the overlap. Real-time synchronization itself is required (SR-1), so the Live Updates switches can only control presentation. Compliance field locks (Q-RCP-2) override display toggles when set.
- **Options:** (a) Feature = module availability, Preference/Receipt = behaviour within an enabled module (both must be on). (b) Remove the duplicate from one page. (c) One page overrides the other.
- **Implementation needs:** precedence rule for each overlapping pair, including the Settings → Payments cash toggles (C-22).
- **Decision:** ⚠ OPEN

### Q-SET-3 Missing permission keys
- **Why it matters:** Several functions have no permission key in the Permissions UI. Phase 3B adds new backend settings sections and functions, extending the list. Gap keys (Admin-only until decided): `archive.manage`, `history.export`, `settings.terminology`, `terminals.manage`, `settings.security`, `settings.archiving`, `settings.offline`, `settings.compliance`, `sync.review`, `audit.view`.
- **Options:** (a) Add dedicated configurable keys to the Permissions page. (b) Keep them Admin-only, not configurable. (c) Mixed — some configurable, some fixed Admin-only (e.g. compliance, security).
- **Implementation needs:** permission catalogue entries and default role grants (seeded, SR-9); protected flags; Permissions UI changes in a later phase.
- **Decision:** ⚠ OPEN

### Q-SET-4 ★ Default values for newly configurable settings *(new in Phase 3B)*
- **Why it matters:** Phase 3B decisions make several behaviours configurable but approve no default values: `archiving.auto_archive_after`, `archiving.restore_window`, `archiving.retention_period`, `security.idle_timeout_minutes`, `offline.enabled`, `offline.sync_review_threshold`, offline limits (Q-TRM-7), `payments.cash_rounding`. Production initialization seeds settings documents with neutral values (SR-9).
- **Options:** (a) The owner chooses each value in the setup wizard. (b) Documented neutral shipped defaults, editable later. (c) Behaviour off/empty until configured (e.g. auto-archive and cash rounding disabled, offline disabled).
- **Implementation needs:** default settings documents; validation ranges and allowed lists; retention must respect Q-ARC-3 (nothing disposed until a verified minimum exists); UI screens for `security`, `archiving`, `offline`, `compliance` in a later phase.
- **Decision:** ⚠ OPEN

### Q-FEAT-1 When Inventory / Ingredient Tracking is disabled, are movements still recorded?
- **Why it matters:** Products now carry `track_units` and `track_ingredients` (Q-INV-1), each gated by its feature; reservations are made at order creation (Q-INV-2).
- **Options:** (a) No stock effects (no reservation, no sale movement) while disabled. (b) Movements recorded silently; UI hidden. (c) Disabling is blocked while stock exists or reservations are open.
- **Implementation needs:** reservation behaviour for open orders when a feature is switched; POS availability while disabled.
- **Decision:** ⚠ OPEN

### Q-FEAT-2 When a feature is disabled, can Admin still view its historical data?
- **Options:** (a) Hidden entirely until re-enabled. (b) Read-only access for Admin. (c) Visible in reports only.
- **Implementation needs:** read endpoints behaviour under FEATURE_DISABLED (historical refunds stay visible regardless — Q-REF-4).
- **Decision:** ⚠ OPEN

### Q-EXP-2 Custom expense categories
- **Options:** (a) Fixed list (current UI). (b) Business-defined categories.
- **Decision:** ⚠ OPEN

## 12. OTHER ARCHITECTURAL DECISIONS

### Q-BUS-1 Single business or multiple branches?
- **Why it matters:** Affects scoping of every table, settings inheritance, reporting, document series and terminals.
- **Options:** (a) Single business, single branch per deployment (blueprint assumption). (b) One business, multiple branches. (c) Multiple businesses (multi-tenant SaaS).
- **Decision:** ⚠ OPEN

### Q-ARCH-1 ★ Database hosting and access
- **Why it matters:** The docs mention Supabase or self-hosted PostgreSQL without choosing. Server authority (SR-2), transactional locking (SR-3) and the outbox (SR-1) assume all writes go through the backend.
- **Options:** (a) Supabase-hosted PostgreSQL accessed only by the FastAPI backend. (b) Self-hosted PostgreSQL. (c) Supabase with direct client access (would require row-level security and must not bypass server authority for writes).
- **Implementation needs:** connection/pooling, backups, scheduled jobs (auto-archive), environment for the setup wizard (Q-AUTH-8).
- **Decision:** ⚠ OPEN

### Q-ARCH-2 File/image storage
- **Why it matters:** Product images, business logo and receipt logo need storage.
- **Options:** (a) Object storage (e.g. Supabase Storage/S3-compatible). (b) Backend filesystem. (c) Database blobs.
- **Decision:** ✅ DECIDED — (a) **Supabase Storage** for product images. Public-read bucket `product-images`; objects at `{business_id}/{product_id}/{uuid}.{ext}` (new UUID per upload, so caches never serve a stale image). `products.image_url` stores only the public URL — no binary/base64 in PostgreSQL. Uploads go **through the backend** (`POST /products/{id}/image`, ✱products.edit) using a server-only service-role key (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PRODUCT_IMAGE_BUCKET`; never a `VITE_` variable); the bucket has no client write policies. The browser downsizes to ≤ 800×800 WEBP (q≈0.85, transparency kept); the server re-validates type, magic bytes and size (PNG/JPEG/WEBP ≤ 2 MB; SVG/HTML rejected). Replacing deletes the previous object after the new URL committed; `DELETE /products/{id}/image` clears the URL and removes the object. The business/receipt logo keeps its existing settings-stored implementation for now.

### Q-ARCH-3 ★ Real-time transport
- **Why it matters:** Real-time synchronization while online is already required (SR-1); only the **transport** is open. Events are written to the `domain_events` outbox in the same transaction, published after commit, carry a per-business `sequence`, and are permission-filtered with minimal payloads (AR-16).
- **Options:** (a) Server-Sent Events (`GET /events/stream`). (b) WebSocket (`/ws`). (c) Database realtime channel. Polling (`GET /events?after_sequence=`) remains the replay/fallback path in every option.
- **Implementation needs:** stream authentication (session + device credential); resume from `last_sequence`; replay window and RESYNC_REQUIRED; per-channel permission filtering; proxy/hosting support.
- **Decision:** ⚠ OPEN

### Q-ARCH-4 Printing integration
- **Why it matters:** Printed sales documents, provisional offline slips, pre-payment slips (Q-RCP-3) and "open cash drawer" need a device path; no printing integration exists.
- **Options:** (a) Browser print dialog. (b) Local print agent/bridge. (c) Network printer protocol from backend. (d) Deferred.
- **Implementation needs:** paper width(s); logo printing on thermal paper.
- **Decision:** ⚠ OPEN

---

## 13. Approved system rules (SR-1 … SR-11)

Binding rules from the owner brief — not questions.

| SR | Rule |
|---|---|
| **SR-1** Real-time synchronization while online | Events for new orders, order status changes, payment state changes, inventory changes, stock warnings, relevant settings changes, terminal/session state, staff operational status. Transport **Q-ARCH-3** (open); precedence of Features → Live Updates / Preferences → Live Updates & Auto Refresh **Q-SET-2** (open). |
| **SR-2** Server authority | The server/database is authoritative. The client may render optimistic state; the server result wins; on rejection the client reverts and shows the reason. Never trust client totals, prices, stock, discounts, taxes, permissions or payment status. |
| **SR-3** Concurrency | Inventory: one DB transaction, stock rows locked in a deterministic order, conditional updates, DB check constraints as last defence, no silent overwrite. Orders: `version` + server state-machine validation; invalid transition → 409 INVALID_TRANSITION; stale version → 409 VERSION_CONFLICT; no double completion (order row locked; completion checks status + settlement). Payments/refunds: Idempotency-Key; order row locked while computing remaining balance / refundable amount; no duplicate records from retries. |
| **SR-4** Offline sync protocol | Device-generated unique `client_txn_id` (UUID). Reconnect: send queued transaction → server persists raw submission (`offline_submissions`, unique client_txn_id) → idempotency check (duplicate returns stored outcome) → validate (terminal, user, snapshot version, prices recomputed from the server's stored snapshot, discount, cash-only) → validate inventory/payment/order state under locks → commit (canonical order number, payments, movements, sales document, audit, events) → client marks synced. Conflict → `needs_review`; nothing applied to stock/money; Admin reconciliation, audited; original submission never modified. |
| **SR-5** Offline inventory | Local stock snapshot; local tracking and blocking; every local stock effect recorded in the queue; server reconciles on sync; conflicts flagged; server stock never overwritten; corrections only via explicit Admin movements. |
| **SR-6** History preservation | Never hard-delete: orders (incl. completed and cancelled), order items/choices/discounts, payments, refunds (+ lines/allocations), sales documents, document prints, stock movements, audit logs, settings history, offline submissions. Configuration objects per Q-DEL-1. |
| **SR-7** Auditability | Immutable `audit_logs` for: refunds; discount application/authorization (incl. ID-capture event, not the ID value); inventory restock/adjust/correction; manual archive; automatic archive (system actor); restore; cancellation; reprint; staff create/edit/deactivate/role change; permission changes; settings changes (all sections incl. compliance); password/PIN set, change, reset; lockouts; setup completion; terminal registration/activation/reset/deactivation; offline reconciliation decisions; retention configuration. |
| **SR-8** Money | The server computes subtotal, discount, tax, total, amount due, change, refund amount and rounding. Client-entered payment amount/tendered are requests validated against server-computed balances. One representation (decimal, 2 dp) and one rounding policy (Q-TAX-3). |
| **SR-9** Fresh system | Production init seeds only: roles, permission catalogue, default role grants, default settings documents (neutral values; tax disabled, no rate), sequences and a default neutral document series at start values, `system_state = not_started`. Business row and first Admin are created by the owner in the wizard (Q-AUTH-1), not seeded. Never: products, categories, choices, ingredients, inventory, orders, payments, documents, expenses, customers, discounts, analytics, fake staff. |
| **SR-10** Temporary UI data | Frontend mock/demo data must be removed or replaced with live backend data in the integration phase; **not** removed in Phase 3B (SYSTEM-LOGIC §8). |
| **SR-11** Compliance verification | VR items (§14) must be verified before production; the architecture keeps them as configuration so verified rules can be implemented without redesign. |

## 14. Verification register (⚖)

Every item below **must be verified against applicable requirements before production use**. Until then, the architecture keeps each as configuration (mostly the `compliance` settings section, every value ⚖) so a verified rule can be implemented without redesigning the core POS. Nothing here states what the requirement is.

| VR | Topic | Related |
|---|---|---|
| VR-1 | Senior Citizen / PWD statutory treatment (discount & tax/VAT treatment, receipt/report content) | Q-DSC-2 |
| VR-2 | Required identification / recordkeeping for Senior/PWD | Q-DSC-3 |
| VR-3 | Philippine invoicing / sales document requirements (document type/title, numbering, series/ranges, registration, mandatory content, reprint marking, refund documents, offline issuance) | Q-RCP-1, Q-RCP-2, Q-RCP-3, Q-RCP-5 |
| VR-4 | Tax-specific treatment (taxability classes, rate, inclusive/exclusive, tax after discount, rounding method) | Q-TAX-1, Q-TAX-2, Q-TAX-3 |
| VR-5 | Cash rounding requirements (whether permitted, increments, display) | Q-PAY-2 |
| VR-6 | Data retention requirements (minimum periods per record type, disposal) | Q-ARC-3, Q-ARC-5 |
| VR-7 | Privacy / data-protection (customer IDs & names, staff data, access, masking, retention) | Q-DSC-3, Q-ORD-5, Q-ARC-3 |
| VR-8 | Refund / consumer-protection documentation (carried from Phase 3A) | Q-REF-2 |

## 15. Recorded interpretations

Where the approved wording needed interpretation to be implementable, the interpretation used by all documents is recorded here.

- **I-1** The brief's option letters do not correspond to the Phase 3A option lists; the approved wording is applied — confirm if different.
- **I-2** Payment may be recorded at any time between order creation and completion; the canonical flow collects it at Ready for Pickup, and a POS "pay now" step is Q-ORD-6 — confirm if different.
- **I-3** "Reserve/deduct at creation" is implemented as a reservation model (`on_hand` / `reserved`, available = on_hand − reserved) that becomes the sale at completion — confirm if different.
- **I-4** A Cashier's authentication method (password or PIN) is chosen per account by an Admin in Staff — confirm if different.
- **I-5** The idle timeout is one business-wide value in the `security` settings section, not per user or terminal — confirm if different.
- **I-6** The ordinary discount is computed on listed prices and tax is computed after it; the per-discount "Tax Handling" option is retired for ordinary discounts — confirm if different.
- **I-7** The order discount is allocated pro-rata across eligible lines by line amount (largest-remainder) — confirm if different.
- **I-8** Half-up to 0.01 is kept as the one rounding policy — confirm if different.
- **I-9** The sales document is issued when the order is fully settled — confirm if different.
- **I-10** The offline baseline scope listed under Q-TRM-3 is used until Q-TRM-7 is decided — confirm if different.
- **I-11** Restored orders are excluded from automatic re-archiving (manual re-archive allowed) — confirm if different.
- **I-12** Nothing is disposed until a verified retention minimum is configured — confirm if different.
- **I-13** Identification capture is configured per discount definition (`requires_identification`, `identification_fields`) — confirm if different.
- **I-14** Refunds apply to completed orders; money returned on a paid-but-not-completed order is handled under Q-CAN-1 — confirm if different.

---

## Summary

- **Decided: 31** — Q-ARCH-2, Q-ORD-1, Q-INV-1, Q-INV-2, Q-INV-3, Q-PAY-1, Q-PAY-2, Q-REF-4, Q-REF-1, Q-DSC-1, Q-DSC-2, Q-DSC-3, Q-TAX-1, Q-TAX-2, Q-TAX-3, Q-RCP-1, Q-RCP-2, Q-ARC-1, Q-ARC-4, Q-ARC-2, Q-ARC-3, Q-DEL-1, Q-AUTH-1, Q-AUTH-2, Q-AUTH-4, Q-TRM-1, Q-TRM-2, Q-TRM-3, Q-TRM-4, Q-TRM-5, Q-SET-1.
- **Open: 38** — Q-ORD-2, Q-ORD-3, Q-ORD-4, Q-ORD-5, Q-ORD-6, Q-ING-2, Q-ING-3, Q-ING-4, Q-PAY-3, Q-PAY-4, Q-REF-2, Q-REF-3, Q-REF-5, Q-CAN-1, Q-DSC-4, Q-RCP-3, Q-RCP-4, Q-RCP-5, Q-ARC-5, Q-EXP-1, Q-EXP-2, Q-AUTH-3, Q-AUTH-5, Q-AUTH-6, Q-AUTH-7, Q-AUTH-8, Q-TRM-6, Q-TRM-7, Q-TRM-8, Q-SET-2, Q-SET-3, Q-SET-4, Q-FEAT-1, Q-FEAT-2, Q-BUS-1, Q-ARCH-1, Q-ARCH-3, Q-ARCH-4.
  - **★ Blocking open: 12** — Q-PAY-3, Q-REF-2, Q-REF-5, Q-CAN-1, Q-RCP-5, Q-AUTH-7, Q-AUTH-8, Q-TRM-7, Q-TRM-8, Q-SET-4, Q-ARCH-1, Q-ARCH-3.
  - **⚖ Open: 5** — Q-ORD-5 (VR-7), Q-REF-2 (VR-8), Q-RCP-3 (VR-3), Q-RCP-5 (VR-3), Q-ARC-5 (VR-6, VR-7).
- **Approved system rules: 11** (SR-1 … SR-11). **Verification items: 8** (VR-1 … VR-8). **Recorded interpretations: 14** (I-1 … I-14).
- **Phase 3A → 3B:** of the 55 Phase 3A questions, **25 are decided** and **30 remain open** (Q-OFF-1 retired into Q-TRM-2; old Q-TRM-2 renumbered Q-TRM-6). **5 new decided IDs** (Q-TRM-3, Q-TRM-4, Q-TRM-5, Q-ARC-4, Q-REF-4) → 30 decided. **10 new open IDs** (Q-ORD-6, Q-REF-5, Q-RCP-5, Q-ARC-5, Q-AUTH-6, Q-AUTH-7, Q-AUTH-8, Q-TRM-7, Q-TRM-8, Q-SET-4) → 40 open.

## Contradictions

| ID | Where / issue | Phase 3B status |
|---|---|---|
| C-1 | Two password policies: Staff UI (`types/auth.ts`: 8+, letter, number) vs Account UI (`accountStore.ts`: 8+, number, uppercase) | Resolved in principle by Q-AUTH-2: one server-enforced credential policy; values **Q-AUTH-7** (open). UI unchanged. |
| C-2 | Settings → Branding logo vs Settings → Receipts logo | OPEN → Q-RCP-4 |
| C-3 | "Show Tax on Receipt" (Tax) vs "Show Tax" (Receipts) | OPEN → Q-SET-2; compliance field locks (Q-RCP-2) override display toggles when set |
| C-4 | `catalogStore.DEFAULT_LOW_STOCK_THRESHOLD = 5` vs Staffing default 10 | RESOLVED by Q-INV-4 (Staffing value is the default for new items; catalogue display fallback no longer a creation default) |
| C-5 | Features vs Preferences duplicate switches (sounds, live updates, alerts) | OPEN → Q-SET-2 (simplified: both business-wide now, Q-SET-1) |
| C-6 | `ReceiptStatus` has `partial-refund`; History UI refunds full only | RESOLVED by Q-REF-1 (UI adds partial refunds later; granularity Q-REF-5) |
| C-7 | Orders demo shows unpaid orders; POS checkout requires payment | RESOLVED by Q-ORD-1 (POS UI adds create-without-payment later; Q-ORD-6) |
| C-8 | Docs said Settings → Receipts was not built | FIXED in SYSTEM-LOGIC §2.1/§3.1/§7/§9 and the USER-FLOWS Settings section |
| C-9 | Interim placeholders in Phase 3A BUSINESS-RULES R1.3, R3.5, R4.1, R5.2, R7.4, R12.1, R13.5 (Phase 3A numbering) | REPLACED where decided — now Q-INV-3 → R3.6, Q-INV-2 → R4.2, Q-DSC-1 → R5.1, Q-PAY-1 → R7.2, Q-ARC-1/Q-ARC-4 → R12.2–R12.4; Q-ORD-2 stays OPEN (now R1.7, labelled interim); Q-AUTH-5 stays OPEN (R13.5; wrong reference to Q-AUTH-1 fixed) |
| C-10 | `RESTORE_WINDOW_HOURS = 48` hard-coded | RESOLVED by Q-ARC-2 (setting; UI constant temporary) |
| C-11 | Fixed terminal list REG-01…03 vs Staffing max terminals | RESOLVED by Q-TRM-1 (registry + activation; UI list temporary) |
| C-12 | Discounts UI per-discount Tax Handling vs Q-TAX-2 | RESOLVED in docs: backend removes per-discount tax handling for ordinary discounts; UI control revised later |
| C-13 | BUSINESS-RULES R12.3 cited Q-ARC-1 for the restore window | FIXED → Q-ARC-2 |
| C-14 | SYSTEM-LOGIC said order and receipt numbers gap-free; BUSINESS-RULES said order numbers may have gaps | FIXED: order numbers may have gaps; document numbers gap-free within a series (design goal, ⚖ VR-3) |
| C-15 | SYSTEM-LOGIC §5 "Order paid → stock deduction"; API checkout = pay-first single transaction | FIXED: reservation at creation; `POST /orders` + separate payments |
| C-16 | DATABASE: one payment per order, `order 1─1 receipt`, single `refunds.payment_id`, `stock_mode` enum, `discounts.tax_handling`, preferences per user | FIXED per Phase 3B decisions |
| C-17 | Old Q-AUTH/Q-TAX/Q-TRM numbering vs owner brief | FIXED by the ID crosswalk |
| C-18 | Retention (Q-ARC-3) vs never-hard-delete (SR-6) | RECONCILED: nothing disposed until a verified minimum is configured; end-of-retention handling Q-ARC-5 (open) |
| C-19 | Refunds toggle OFF vs cancellation of a paid order needing money returned | OPEN → Q-CAN-1 (risk AR-14) |
| C-20 | Phase 3A "Admin PIN" / "PIN override" approval options vs Q-AUTH-2 (Admins cannot use a PIN) | FIXED: any future approval flow (Q-DSC-4, Q-AUTH-3) uses Admin password re-entry |
| C-21 | Permission key names `staff.resetPasswords`, `receipts.view` / `receipts.reprint` vs PIN reset and /documents | RESOLVED: the 48 keys are frozen; `staff.resetPasswords` covers password and PIN resets; `receipts.view` / `receipts.reprint` cover /documents (PERMISSIONS §2) |
| C-22 *(new)* | Settings → Payments cash toggles "Require cash received amount" (`requireCashReceived`) and "Calculate change automatically" (`autoChange`); Phase 3A BUSINESS-RULES recorded change only when auto change was on — vs Q-PAY-1 "Cash: calculate change automatically" (server computes `change_given = tendered − amount`) | OPEN → Q-SET-2. Interim safe behaviour — not a decision: the server always computes and stores `change_given` whenever `tendered` is recorded; the toggles control UI prompts/display only. |
| C-23 *(new, final check)* | `/setup/*` "permanently 409 after completion" vs USER-FLOWS §1 (device calls `GET /setup/status` to choose wizard vs Login) | FIXED: `GET /setup/status` is read-only and always readable; only setup write endpoints return 409 SETUP_ALREADY_COMPLETED |
| C-24 *(new, final check)* | Cash rounding "up" collects more than the remaining balance vs OVERPAYMENT cap | FIXED: for a rounded settling cash payment the cap applies to `amount + rounding_adjustment` (= remaining), per Q-PAY-2 |

## Phase 3B document changes

- **DECISIONS.md** — rewritten as the Decision Register: ID crosswalk, 30 decided entries with approved rules and consequences, 40 open entries, SR-1…SR-11, VR-1…VR-8, recorded interpretations, contradiction status.
- **BUSINESS-RULES.md** — restructured to the fixed §0–§23 map; decided rules stated (reservation model, no negative stock, split payments and settlement, cash rounding, full/partial refunds and Refunds toggle, one discount, ID capture, tax after discount, rounding policy, sales documents and reprint, archiving/retention, setup wizard, flexible authentication, idle timeout, terminals); new sections for fresh system & setup, offline, real-time & concurrency, audit, history preservation and compliance configuration; C-9 placeholders replaced.
- **SYSTEM-LOGIC.md** — current state corrected (Settings → Receipts complete, C-8); domain model and lifecycles aligned with the decisions; §9 now summarizes and links here; new §10 real-time, §11 concurrency & consistency, §12 offline, §13 compliance-ready architecture, §14 architectural risks (AR-1…AR-20).
- **USER-FLOWS.md** — order-first/pay-later flow, split payments, partial refunds, setup wizard, terminal activation, PIN/password login, idle timeout, offline selling and sync review; Settings → Receipts described as complete; UI items still to revise noted.
- **PERMISSIONS.md** — Refunds feature gate, auth-method rules, setup and terminal activation, gap keys listed as Admin-only until Q-SET-3.
- **DATABASE.md** — C-16 fixes: `stock_levels` (on_hand/reserved), `track_units`/`track_ingredients`, `tax_class`, split `payments`, `refunds` + `refund_lines` + `refund_allocations`, `documents` / `document_series` / `document_prints`, `system_state`, session and terminal activation fields, `offline_submissions`, `pos_snapshots`, `domain_events`, `idempotency_records`, new settings sections; descriptive tables only.
- **API.md** — setup endpoints, `POST /orders` replaces checkout, split payments, refunds, documents, archive, sync, event stream (transport Q-ARCH-3), settings sections, error codes and Idempotency-Key requirements; descriptive only, no implementation.
