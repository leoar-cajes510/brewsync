# BrewSync — System Logic Blueprint

> Status: **Phase 3B (2026-09-27) — business rules finalized, system architecture defined. Documentation only; nothing described here is implemented yet.**
> Companion documents: [DECISIONS.md](DECISIONS.md) (source of truth for decision status) · [BUSINESS-RULES.md](BUSINESS-RULES.md) · [USER-FLOWS.md](USER-FLOWS.md) · [PERMISSIONS.md](PERMISSIONS.md) · [DATABASE.md](DATABASE.md) · [API.md](API.md)
>
> Markers: **★** high priority · **⚖** requires legal/business verification before production (VR-ID, see §13) · **⚠ OPEN (Q-ID)** not decided · **✱** permission · **⚑** feature gate.
> Decision IDs are the canonical Phase 3B IDs (crosswalk from Phase 3A IDs in [DECISIONS.md](DECISIONS.md)). Nothing in this document is a legal statement and BrewSync claims no automatic BIR or other legal compliance.

---

## 1. What BrewSync is

A single-business POS and back-office system for food & beverage businesses (café, restaurant, bakery, grilling restaurant, etc.). One deployment serves **one business** (multi-branch ⚠ OPEN Q-BUS-1), operated from one or more **registered and activated terminals** (Q-TRM-1) by **staff** in two roles: **Admin** and **Cashier**.

Core loop (order first, pay later — Q-ORD-1):

```
Catalog (products, choices, recipes, stock levels) ──► pos_snapshot (catalog_version)
   │
   ▼
POS cart (client-side) ──POST /orders──► Order created — stock RESERVED (reservation movements, all-or-nothing)
                                           │
                                           ▼
                                  Orders board (real-time): pending → preparing → ready ("Ready for Pickup")
                                           │
                                           ▼
                                  Payment(s) — split allowed; cash / GCash / card / bank transfer
                                           │  fully settled ─► Sales document issued (UI "Receipt"; number from document_series)
                                           ▼
                                  Completion — reservation → sale (sale movements)
                                           │
                                           ▼
                                  History / Analytics ─► Archive (automatic for completed, manual for cancelled)
   cancel before completion ─► reservation released (reservation_release)
   refund (completed orders, ⚑Refunds) ─► refund + refund_lines + refund_allocations (separate records)

Offline terminal:  local snapshot ─► offline order + cash payment ─► append-only queue ─► POST /sync/transactions
                   ─► server validates & commits (or needs_review) ─► client marks synced            (§12)

Every committed change ─► domain_events outbox (same transaction) ─► dispatcher ─► event stream to terminals (§10)
```

The **server/database is authoritative** for every number, status, stock quantity and permission (SR-2). The React frontend displays, requests and may render optimistic state, but the server result always wins; it never decides totals, prices, discounts, taxes, stock, payment status or access.

---

## 2. Current project state (inspected, 2026-09-27)

### 2.1 Frontend (`frontend/`)
- React 19 + TypeScript + Vite + react-router 7. **27 routes, all implemented — including Settings → Receipts** (C-8 fixed; earlier docs wrongly said it was a placeholder).
- Settings → Receipts configures **display settings** only: printed/digital format, receipt logo, header toggles (logo, business name, address, phone, email), transaction-information toggles (cashier, terminal, order number, reference, date/time, payment method, tax, discount, customer), and texts — heading (≤ 32), thank-you (≤ 40), footer (≤ 80), small print (≤ 120). Compliance locks are separate (§13).
- State is **temporary, in-memory** — see §8 for the full inventory of temporary code and mock/demo data.
- Empty stubs (0 bytes) for the future integration layer: `services/*.ts` (api, auth, product, inventory, order, payment, expense, analytics, settings), `hooks/*.ts` (useAuth, useProducts, useInventory, useOrders, useSettings, useRealtime, useAdminAccess), `stores/authStore.ts`, `stores/orderStore.ts`, `stores/settingsStore.ts`, `types/settings.ts`, `components/auth/*` (LoginForm, ProtectedRoute, AdminGuard), `components/settings/*` (LivePreview, SettingCard, SettingSaveBar, SettingSection), `utils/validation.ts`.

### 2.2 Backend (`backend/`) — unchanged in Phase 3B
- FastAPI app factory (`app/main.py`), settings via pydantic-settings (`app/core/config.py`), and a working **`GET /health`** router — the only implemented endpoint.
- Every other module is an **empty file**; the intended layout exists: `core/` (config, exceptions, permissions, security), `database/` (base, connection, session), `domain/` (cart, discount, inventory, order, payment, product, receipt, tax), `models/` (17 files), `repositories/` (7), `schemas/` (12), `services/` (14), `routers/` (16 incl. health), `tests/unit` (6), `tests/integration` (4).
- `requirements.txt`: fastapi, uvicorn, pydantic-settings only (no ORM, driver, or migration tool dependency yet).
- `alembic/` folder (with an empty `versions/`) is present; **no migrations are written**. `docker-compose.yml` at the project root is empty.

### 2.3 Design (`design/stitch/`)
27 approved mockups (`.jpg`). They contain illustrative names, terminals, IPs and figures; those are **visual only** and must never become seed data (SR-9).

### 2.4 Documentation
All docs are at **Phase 3B**: 30 decisions DECIDED, 40 OPEN ([DECISIONS.md](DECISIONS.md)); this document adds the real-time (§10), concurrency (§11), offline (§12) and compliance-ready (§13) architecture and the risk register (§14).

---

## 3. Domain model (conceptual)

The original entity list was evaluated in Phase 3; Phase 3B updates it to the decided rules.

| Decision | Entity | Reason |
|---|---|---|
| Keep | User, Role, Permission, Business, Terminal, Product, Category, ChoiceGroup, ChoiceOption, Ingredient, Order, OrderItem, Payment, Discount, Expense, AuditLog | Direct UI/workflow need. |
| **Split** | `Recipe` → **Recipe** + **RecipeLine** | A recipe is a list of ingredient quantities per product. |
| **Replace** | `InventoryItem` / ProductStock / ingredient stock fields → **StockLevel** (`subject_type` product / ingredient, `on_hand`, `reserved`) | Q-INV-1 (both stock kinds), Q-INV-2 (reserve at creation), Q-INV-3 (no negative stock) need one reservation-aware model for both. |
| Keep (revised) | **StockMovement** — one ledger with `subject_type`, `delta_on_hand`, `delta_reserved` | Same ledger rules for units and ingredients; reservation, release and sale are movements. |
| **Add** | **OrderItemChoice** | Snapshot of each selected option (name + price) on a line. |
| **Add** | **OrderDiscount** (applied-discount snapshot, max one per order) | Q-DSC-1; freezes label/amount; holds identification fields when required (Q-DSC-3). |
| **Replace** | `Receipt` → **Document** + **DocumentSeries** + **DocumentPrint** | Q-RCP-1/Q-RCP-2: separate document number from a configurable series, compliance-ready types, reprint records. ⚖ VR-3 |
| **Add** | **Refund** + **RefundLine** + **RefundAllocation** | Q-REF-1: full/partial refunds as separate immutable records linked to order, document and payment(s). |
| **Add** | **Session** | Binds user + terminal + time; `last_activity_at` drives the idle timeout (Q-AUTH-4). |
| **Add** | **ProductChoiceGroup** (link) | Choice groups are reusable across products. |
| **Add** | **SystemState** (singleton) | First-run setup wizard status (Q-AUTH-1). |
| **Add** | **PosSnapshot** | Catalog/pricing/settings bundle per `catalog_version`; retained so offline sales can be re-priced by the server (SR-4, AR-4). |
| **Add** | **OfflineSubmission** | Raw offline transaction as received; unique `client_txn_id` (SR-4). |
| **Add** | **DomainEvent** (outbox) | Real-time events written in the same transaction, per-business `sequence` (SR-1, §10). |
| **Add** | **IdempotencyRecord** | No duplicate payments/refunds/orders from retries (SR-3, §11). |
| **Add** | **ExpenseCategory** (fixed enum now) | Custom categories ⚠ OPEN Q-EXP-2. |
| **Add** | **Sequence / Counter** | Operational counters: order number (**gaps acceptable**), expense code, staff code, product code. **Document numbers come from `document_series`, not from here** (C-14 fixed). |
| **Merge** | `Tax` → **TaxSettings** + `products.tax_class` | One configured tax; taxability per product (Q-TAX-1). Further classes are compliance configuration. ⚖ VR-4 |
| **Merge** | `Setting` → **typed settings sections** | Each section is a typed, versioned, business-wide document (incl. new `security`, `archiving`, `offline`, `compliance`). |

### 3.1 Entity catalogue

For each: **Purpose · Key attributes · Relationships · Behaviour · Depended on by**. Column-level detail lives in DATABASE.md.

**Business** — The tenant. · name, type (Café/Restaurant/Grilling Restaurant/Bakery/Food & Beverage/Custom), tagline, address, phone, email, currency code + symbol, timezone. · Owns everything below. · Created by the owner in the setup wizard (not seeded). · Documents, POS header, analytics currency, business-day boundaries, all scoping.

**SystemState** — Installation singleton. · `setup_status` (`not_started` / `in_progress` / `completed`). · Gate for every endpoint: before completion only `/setup/*` and `/health` (409 SETUP_REQUIRED); after completion `/setup/*` returns 409 SETUP_ALREADY_COMPLETED. · Complete Setup is one atomic transaction (business + first Admin + status + audit) (Q-AUTH-1).

**User** — A staff login. · code (e.g. STF-01), full_name, username (unique, `^[a-z0-9._-]{3,20}$`), role_id, `auth_method` (`password` / `pin`), password_hash, pin_hash, failed_attempts, locked_until, must_change_credential, credential_set_at, default_terminal_id, status (active/inactive), last_active_at. · Belongs to Business, Role; has Sessions; authors Orders, Payments, Refunds, Expenses, StockMovements, AuditLogs. · Admin must use `password` (422 AUTH_METHOD_NOT_ALLOWED); Cashier uses `password` or `pin` as chosen by an Admin; the server accepts only the selected method; lockout 423 ACCOUNT_LOCKED; PIN sign-in only from an activated terminal (Q-AUTH-2). Policy values ⚠ OPEN Q-AUTH-7. Username rename ⚠ OPEN Q-AUTH-5. Deactivate, never delete once referenced (Q-DEL-1).

**Role** — Admin or Cashier (fixed set). · key, name, is_system. · Has many RolePermissions. · Admin is protected (PERMISSIONS §4). · Authorization everywhere.

**Permission / RolePermission** — One grantable capability: the 48 keys of Settings → Permissions plus gap keys (`archive.manage`, `history.export`, `settings.terminology`, `terminals.manage`, `settings.security`, `settings.archiving`, `settings.offline`, `settings.compliance`, `sync.review`, `audit.view`) that stay Admin-only until ⚠ OPEN Q-SET-3. · key, group, label, protected flag; RolePermission(role, key, granted). · Checked by every protected endpoint.

**Terminal** — A registered register/device. · code (REG-01), name, status (`pending_activation` / `active` / `inactive` / `revoked`), activation_code_hash, activation_expires_at, device_credential_hash, activated_at, activated_by, registered_at, last_seen_at. · Sessions, Orders, Payments, Documents, OfflineSubmissions reference it. · Admin registers → one-time short-lived activation code (shown once, stored hashed) → device activates and receives a device credential (secret on device, hash on server). Identity at login comes from the device credential, never from a client-supplied code. Maximum Active Terminals enforced at activation/reactivation (Q-TRM-1). Staff restriction to assigned terminals ⚠ OPEN Q-TRM-6; first device / Admin access without a terminal ⚠ OPEN Q-TRM-8.

**Session** — A signed-in period on a terminal. · user_id, terminal_id, started_at, `last_activity_at`, ended_at, `end_reason` (`logout` / `lock` / `idle_timeout` / `forced` / `user_deactivated` / `terminal_revoked`), refresh token hash. · Orders and payments capture it. · Server ends a session idle longer than `security.idle_timeout_minutes` (401 SESSION_EXPIRED); `last_activity_at` updates on user-initiated requests only (not heartbeats/background refresh) (Q-AUTH-4). Concurrent sessions per user ⚠ OPEN Q-AUTH-6. · Presence, attribution, Account page.

**Category** — Product grouping for POS tabs. · name, sort_order, active. · Has Products. · Hard delete only if never referenced, otherwise deactivate (Q-DEL-1). · POS category bar, analytics by category.

**Product** — Sellable item. · code (unique), name, description, category_id, base price, image_url, available (shown on POS), active (sellable at all), **`track_units`** (unit stock), **`track_ingredients`** (recipe consumption), **`tax_class`** (baseline `taxable` / `non_taxable`, ⚖ VR-4), created/updated. No `stock_mode`. · Has StockLevel (0..1, when `track_units`), Recipe (0..1), ProductChoiceGroups, OrderItems. · Either, both or neither flag; when both, BOTH stocks must suffice; POS availability = min(unit availability, ingredient-limited availability) (Q-INV-1). Feature-disabled behaviour ⚠ OPEN Q-FEAT-1. · POS, inventory, recipes, analytics.

**StockLevel** — Current stock for one subject. · `subject_type` (product / ingredient), `subject_id`, `on_hand`, `reserved`, `low_stock_threshold` (new-item default = Staffing threshold, Q-INV-4), `last_restocked_at`; `available = on_hand − reserved` (derived). · Changed only together with a StockMovement, inside a transaction, under a row lock. · Invariants: `on_hand ≥ 0`, `reserved ≥ 0`, `reserved ≤ on_hand` (Q-INV-3). · POS availability, inventory, low-stock alerts, offline snapshot.

**ChoiceGroup** — Reusable customization group (Size, Milk…). · code, name, display_name, description, selection type (single/multi), required, min, max, active. · Has ChoiceOptions; linked to Products. · Validates selections (BUSINESS-RULES §2).

**ChoiceOption** — One option. · name, price_delta (≥ 0), active, is_default, sort_order. · Ingredient effects SCALE / ADD / REPLACE (`choice_option_effects`, R4a.3a). · Snapshotted into OrderItemChoice.

**Ingredient** — Raw material. · code, name, category, unit (g, kg, ml, L, pcs), unit_cost, notes, active; stock held in StockLevel (no `stock_quantity` column). · Used by RecipeLines. · Costing ⚠ OPEN Q-ING-3; unit conversion ⚠ OPEN Q-ING-4.

**Recipe / RecipeLine** — Ingredients consumed per one unit of a product. · recipe(product_id) → lines(ingredient_id, quantity in ingredient unit). · Drives ingredient reservation/consumption and product cost.

**StockMovement** — Immutable ledger row. · subject_type, subject_id, type (`initial` · `restock` · `adjustment` · `correction` · `waste` · `reservation` · `reservation_release` · `sale` · `sale_reversal`), `delta_on_hand`, `delta_reserved`, `on_hand_after`, `reserved_after`, reason, note, unit_cost (restocks), `reference_type` (`order` / `refund` / `offline_submission` / `manual`) + reference_id, actor, created_at. · Never edited or deleted; corrections are new rows. · Inventory history, audit, COGS, offline reconciliation.

**PosSnapshot** — Catalog/pricing/settings bundle for one `catalog_version` (products, options, recipes needed for availability, active discounts, tax, payments incl. cash rounding, relevant preferences/offline settings). · Created when catalog- or pricing-relevant data changes; retained while any offline submission may reference it. · Offline recomputation (SR-4), POS catalog.

**Discount** — Definition from Settings → Discounts. · name (unique), type (percentage/fixed), amount, eligibility (all/senior/pwd/student/custom + label), min_order, max_discount, **`requires_identification`**, **`identification_fields`** (subset of customer name, ID type, ID number), active, sort_order. **No `tax_handling`** (C-12; tax always after an ordinary discount, Q-TAX-2). · Senior Citizen / PWD are ordinary definitions (Q-DSC-2); statutory treatment is separate (§13, ⚖ VR-1). · Deactivate once applied (Q-DEL-1).

**Order** — A customer order. · `number` (business sequence, gaps acceptable), `origin` (`online` / `offline`), `version`, `status` (`pending` · `preparing` · `ready` · `completed` · `cancelled`), `payment_status` (server-derived `unpaid` · `partially_paid` · `paid`), `refund_status` (`none` · `partially_refunded` · `refunded`), business_id, terminal_id, session_id, cashier user_id, customer_name (optional, ⚠ OPEN Q-ORD-5 ⚖ VR-7), order_type (dine_in/takeout/delivery), tag (⚠ OPEN Q-ORD-4), note, **frozen totals** (subtotal, discount_total, net_amount, tax_amount, tax_breakdown per tax class, total, tax name/rate/mode snapshot), timestamps (created, started, ready, completed, cancelled), cancel_reason, archived_at / archived_by / archive_reason, restored_at. · Has OrderItems, OrderDiscount (0..1), Payments, Refunds, Documents, StockMovements. · State machine in BUSINESS-RULES §1; editing ⚠ OPEN Q-ORD-2; per-type steps ⚠ OPEN Q-ORD-3.

**OrderItem** — A cart line frozen at order creation. · product_id, product name/code snapshot, tax class snapshot, quantity, unit_price snapshot (base + option deltas), line_total, allocated discount. · Has OrderItemChoices. · History renders even if the product is renamed or deactivated.

**OrderItemChoice** — group_name, option_name, price_delta snapshots (+ option_id reference).

**OrderDiscount** — Unique per order. · discount_id, name/type/amount/eligibility snapshot, computed amount, `customer_name`, `id_type`, `id_number` (only when the definition requires them; 422 IDENTIFICATION_REQUIRED if missing), approved_by (⚠ OPEN Q-DSC-4). · Identification is personal data: stored only when required, visible only to authorized roles, masked in lists, never in real-time events (⚖ VR-2, VR-7).

**Payment** — One money receipt toward an order (split allowed). · `method` (`cash` · `gcash` · `card` · `bank_transfer`), `amount`, `tendered`, `change_given`, `rounding_adjustment`, `reference`, `status` (`pending` · `completed` · `voided`), confirmed_by/at, `idempotency_key`, `origin`, terminal_id, user_id, created_at. · Belongs to Order. · Only completed payments count toward settlement; completed payments are never edited (reversal only through a refund); pending can be voided; confirmation meaning ⚠ OPEN Q-PAY-3 (Q-PAY-1, Q-PAY-2).

**Refund** — Money returned on a completed order. · order_id, document_id (the order's sales document), server-computed amount, reason, restocked (restock ⚠ OPEN Q-REF-3), user, terminal, approved_by, idempotency_key, created_at. · Has **RefundLine** (order item, quantity, amount — granularity ⚠ OPEN Q-REF-5) and **RefundAllocation** (payment_id, amount — method/allocation ⚠ OPEN Q-REF-2 ⚖ VR-8). · Σ refunds ≤ Σ completed payment `amount`; ⚑Refunds (Q-REF-4); restock ⚠ OPEN Q-REF-3; refund document ⚖ VR-3.

**Document** (UI label "Receipt") — Issued sales or refund document. · `document_type` (`sales` / `refund`; titles from compliance settings), series_id, `number`, order_id, refund_id (refund documents), issued_at, immutable snapshot (business header, items, discount, tax lines, payments, cashier, terminal, display settings + compliance locks at issue time), `status` (`issued` · `partially_refunded` · `refunded` · `void` — void only if verified rules allow, ⚖ VR-3), `print_count`, last_printed_at. · Sales document issued in the transaction that fully settles the order. · Reprints never create a new number.

**DocumentSeries** — Numbering series per document type. · format template, scope (business or terminal), start number, next number, optional allocated range, reset policy, active. · Row-locked by the issuing transaction; gap-free within a series as a technical design goal (⚖ VR-3).

**DocumentPrint** — One print or reprint of a document. · document_id, printed_at, printed_by, terminal_id, reprint flag. · Written with an audit record on every reprint; `print_count` incremented.

**Expense** — Business spending. · code (EXP-YYYY-NNN), category (fixed list, ⚠ OPEN Q-EXP-2), description, amount (> 0), date (local), payment_method (Cash/GCash/Card/Bank Transfer/Other), notes, recorded_by, created/updated, voided flag + reason. · Delete vs void ⚠ OPEN Q-EXP-1. · Analytics expenses/profit.

**Settings sections** — business-wide typed documents, each with `version`, `updated_by`, `updated_at`, history kept: `business`, `branding`, `terminology`, `features`, permissions (role grants), `tax`, `payments` (+ `cash_rounding`), discounts (rows), `receipts` (display only — complete in the UI), `staffing`, `preferences` (**business-wide**, Q-SET-1), and backend-first `security`, `archiving`, `offline`, `compliance` (UI in a later phase). Account = the caller's own User record, not a settings document.

**AuditLog** — Append-only record of sensitive actions (SR-7). · actor (user or system actor), action, entity_type, entity_id, before/after (JSON diff, never credentials or ID values), terminal_id, ip/user_agent, created_at. · Never edited/deleted.

**IdempotencyRecord** — key, scope (endpoint + business + actor/terminal), `request_hash`, stored response, created_at. · Written in the same transaction as the effect it protects.

**DomainEvent** (outbox) — event_id, per-business `sequence`, type, entity_type, entity_id, entity_version, occurred_at, actor_id, terminal_id, payload. · Written in the same transaction; published after commit; retained for the replay window.

**OfflineSubmission** — client_txn_id (unique), terminal_id, user_id, captured_at (device), received_at, snapshot_version, payload (never modified), status (`received` · `committed` · `needs_review` · `resolved`), attempts, conflict_reasons, resolution, resolved_by/at, resulting order_id.

**Sequence** — Per-business counters (order_number, expense_code per year, staff_code, product code per category…). Incremented inside the same transaction as the insert; **order numbers may have gaps** from rolled-back transactions. Document numbers are allocated from `document_series` (§13).

**Product codes** — Generated by the server on create as `<category code_prefix>-<n>` with `n` zero-padded to at least 3 digits (`COF-001` … `COF-999`, `COF-1000`), from the row-locked counter `product:<category_id>` (safe under concurrent creation; the counter row is created with `INSERT … ON CONFLICT DO NOTHING`). Numbers are never counted from existing products and never reused; a number whose code is already taken (e.g. an earlier manual code) is skipped, and gaps are allowed. Codes are uppercase and **immutable** (PATCH with a different `code` → 422). Renaming a category never changes its prefix or any product code; the prefix itself cannot be changed (422). Moving a product to another category **keeps its code** (`COF-012` in Tea stays `COF-012`). **Duplicate** creates a new product that gets the next generated code of its category. Order items and documents snapshot the code at sale time, so history is unaffected. Pre-existing codes (e.g. `AMERICANO`) remain valid legacy data.

**Media** (optional) — Stored files (product images, logos). Storage backend ⚠ OPEN Q-ARCH-2.

---

## 4. Python OOP architecture

Layered, dependency direction **routers → services → (domain + repositories) → models/database**. The domain layer imports nothing from FastAPI or SQL.

```
backend/app/
  core/          config, security (hashing, tokens, device credential, CredentialPolicy), permissions (keys, checker),
                 exceptions (domain → HTTP error codes), idempotency helper, setup gate
  database/      engine/connection, session factory, declarative Base, unit-of-work helper (one transaction per use case)
  domain/        PURE business objects & rules (no I/O)
  models/        ORM table classes (persistence shape only)
  repositories/  data access per aggregate (query/save/lock), return domain objects or models
  services/      application use-cases: orchestrate domain + repositories + audit + outbox inside one transaction
  jobs/          scheduled/background work: outbox dispatcher, auto-archive job, overdue-order check
  schemas/       Pydantic request/response DTOs (API contract, validation of shape)
  routers/       FastAPI endpoints: session dependency, permission + feature dependency, call one service, map to schema
```

### 4.1 `domain/` — rich objects, no I/O
| Module | Classes (planned) | Responsibility |
|---|---|---|
| `money.py` (add) | `Money` (Decimal, 2 dp, currency), `Percentage`, `RoundingPolicy` | All arithmetic in one representation. `RoundingPolicy` = half-up to 0.01 applied only at defined points (line total, discount + allocation, tax per order per tax class, total, change, refund amount, cash rounding). Replaceable in one place if a prescribed method is verified (Q-TAX-3, ⚖ VR-4). |
| `product.py` | `Product`, `ChoiceGroup`, `ChoiceOption`, `ChoiceSelection`, `TaxClass` | Validate a selection against min/max/required; compute unit price; expose `track_units` / `track_ingredients` / `tax_class`. |
| `cart.py` | `Cart`, `CartLine` | Merge identical lines (product + option set); quantities; line totals. |
| `discount.py` | `DiscountPolicy` (abstract), `PercentageDiscount`, `FixedDiscount`, `EligibilityRule`, `IdentificationRequirement` | One discount per order; eligibility + min order + cap on listed prices; required identification fields (Q-DSC-1, Q-DSC-3). |
| `tax.py` | `TaxPolicy` (abstract), `InclusiveTax`, `ExclusiveTax`, `NoTax` | Tax per tax class on a discounted taxable amount (included: T − T ÷ (1+r); excluded: T × r). Rate always from settings. |
| `pricing.py` (add) | `PriceCalculator`, `PricingPolicy` (abstract) → `OrdinaryPricingPolicy`, `StatutoryPricingPolicy` | Single pipeline: line totals → subtotal → the one discount → pro-rata allocation across eligible lines (largest remainder) → tax once per order per tax class → total (Q-TAX-2). `OrdinaryPricingPolicy` is the only active policy. `StatutoryPricingPolicy` is an **extension point, disabled** until a `compliance.statutory_rules` entry is verified and enabled (§13, ⚖ VR-1, AR-17). |
| `order.py` | `Order`, `OrderStatus` (state machine), `OrderLine`, `PaymentStatus`, `RefundStatus` | Allowed transitions; `version` guard; freeze totals; completion requires settlement; cancellation rules. |
| `payment.py` | `PaymentMethod` (abstract), `CashTender`, `ReferencePayment` (GCash/Card/Bank Transfer), `Settlement`, `CashRoundingPolicy` | `Settlement`: remaining = total − completed − pending; settled when Σ completed (`amount` + `rounding_adjustment`) = total; derives `payment_status`. `CashTender`: tendered ≥ amount, change = tendered − amount. `ReferencePayment`: exact amount, reference when `require_reference` is on. `CashRoundingPolicy`: `payments.cash_rounding {enabled, increment, mode}` applied only to a cash payment settling the full remaining balance (Q-PAY-1, Q-PAY-2, ⚖ VR-5). |
| `inventory.py` | `StockLevel` (on_hand, reserved, available, status), `Reservation`, `StockLedger`, `StockMovement`, `StockStatus` | Reserve all-or-nothing, release, convert reservation → sale; enforce invariants; reject (never clamp) adjustments below `reserved` / zero (Q-INV-2, Q-INV-3). |
| `recipe.py` (add) | `Recipe`, `RecipeLine`, `ConsumptionPlan` | Expand order lines into unit and ingredient quantities (option SCALE/ADD/REPLACE effects via `resolve_unit_consumption`, R4a.3a); product cost (⚠ OPEN Q-ING-3). |
| `receipt.py` → document module | `SalesDocument`, `DocumentType`, `DocumentNumberAllocator`, `FieldLockSet` | Build the immutable document snapshot from order + `receipts` display settings, with compliance must-print locks overriding display toggles; allocate the next number from a row-locked series using its format template (Q-RCP-1, Q-RCP-2, ⚖ VR-3). |
| `refund.py` (add) | `Refund`, `RefundLine`, `RefundAllocation`, `RefundCalculator` | Compute refund amount server-side; cap Σ refunds ≤ Σ completed payment `amount`; derive `refund_status` / document status (Q-REF-1; granularity ⚠ OPEN Q-REF-5; allocation ⚠ OPEN Q-REF-2). |
| `archive.py` (add) | `ArchivePolicy`, `RetentionPolicy` | Auto-archive eligibility (completed, `completed_at + archiving.auto_archive_after` passed, not restored); cancelled = manual only; restore window check; retention ≥ `compliance.retention_minimum`; **no disposal until a verified minimum exists** (Q-ARC-1..4, ⚠ OPEN Q-ARC-5, ⚖ VR-6). |
| `offline.py` (add) | `OfflineTransactionValidator`, `ConflictReason` | Validate a submission against the stored `pos_snapshot` (re-price), cash-only, terminal/user/permission validity at capture and at sync (deactivated user, revoked permission or revoked terminal since capture → `needs_review`), and inventory/payment/order state → commit plan or `needs_review` reasons (SR-4, SR-5). |
| `compliance.py` (add) | `ComplianceRule` (with `verified_by`, `verified_at`, `verification_reference`), `StatutoryRuleSet` | Holds configured compliance rules; a rule can only be active when its verification metadata is complete (SR-11). |
| `expense.py` (add) | `Expense` | Amount/date/category validation. |
| `permissions.py` (in core) | `PermissionKey` enum (48 + gap keys), `RoleGrants`, `AccessPolicy` | `can(user, permission)`; protected-permission rules; last-Admin protection. |
| `security` (in core) | `CredentialPolicy`, `IdleTimeoutPolicy` | Server-enforced credential rules (values ⚠ OPEN Q-AUTH-7), lockout, idle expiry from `security.idle_timeout_minutes`. |

Use **abstract base classes / Protocols** where behaviour varies by type (TaxPolicy, DiscountPolicy, PricingPolicy, PaymentMethod) — polymorphism instead of `if method == ...` chains.

### 4.2 `services/` — use cases (one transaction each)
| Service | Responsibility |
|---|---|
| `setup_service` (add) | Setup status, business step, first-Admin step, atomic Complete Setup; permanently closed afterwards (Q-AUTH-1; protection ⚠ OPEN Q-AUTH-8). |
| `terminal_service` (add) | Register, issue/hash activation code, activate (device credential), deactivate, reset activation, Maximum Active Terminals, `last_seen_at` (Q-TRM-1). |
| `auth_service` | Login by the account's `auth_method`, device-credential terminal binding, failed attempts + lockout, logout, lock/unlock, credential change, **session validation + idle enforcement** on every request (Q-AUTH-2, Q-AUTH-4). |
| `staff_service` | Staff CRUD, `auth_method`, reset credential, deactivate (ends sessions), last-Admin rules. |
| `settings_service` | Per section, versioned, history, cross-section rules (e.g. retention ≥ minimum), audit, `settings.changed` event; triggers a new `pos_snapshot` when pricing-relevant. |
| `product_service` · `choice_service` · `ingredient_service` (incl. recipes) · `discount_service` | Catalog maintenance; Q-DEL-1 delete-vs-deactivate; bump `catalog_version`. |
| `pos_service` (add) | POS catalog bundle and current `pos_snapshot`. |
| `inventory_service` | Restock / adjust / correction / waste / threshold for units and ingredients; rejects below-reserved adjustments (409 STOCK_RESERVED). |
| `order_service` | Quote, create + reserve (`POST /orders`), status transitions with `expected_version`, cancel (release), complete (reservation → sale). |
| `payment_service` | Split payments, cash tender/change, cash rounding, reference rules, confirm (⚠ OPEN Q-PAY-3), void pending; issues the sales document via `document_service` when fully settled. |
| `refund_service` (add) | Full/partial refunds, lines, allocations, statuses, audit; ⚑Refunds. |
| `document_service` (was `receipt_service`) | Issue sales/refund documents, allocate numbers, reprint (`print_count`, `document_prints`, audit). |
| `archive_service` | Manual archive (reason) and restore (✱archive.manage); used by the auto-archive job. |
| `retention_service` (add) | Validates retention configuration; reports what would become eligible; **performs no disposal until a verified minimum is configured and Q-ARC-5 is decided**. |
| `sync_service` (add) | Snapshot delivery, offline submission intake (persist → idempotency → validate → commit or `needs_review`), device heartbeat, review list, audited resolution. |
| `event_service` (add) | Write `domain_events` in the caller's transaction; replay by `after_sequence`; permission filtering for delivery. |
| `expense_service` · `analytics_service` (read-only) · `audit_service` (write AuditLog, called by the others) | As before. |

Cross-cutting helpers: **idempotency helper** (`core/idempotency.py` — load/store `idempotency_records`, compare `request_hash`), **unit of work** (one transaction; outbox rows and audit rows commit with the business change).

Scheduled/background jobs (`jobs/`): **outbox dispatcher** (publishes committed events in `sequence` order), **auto-archive job** (system actor, audited, business timezone), **overdue-order check** (emits `alert.order_overdue` once per order when Order Waiting Threshold is crossed).

### 4.3 `repositories/`
One per aggregate root: `user`, `role`/`permission`, `terminal`, `session`, `system_state`, `settings` (+ history), `product` (+ category, choice), `ingredient` (+ recipe), `stock` (levels + movements, ordered row locks), `pos_snapshot`, `order` (+ items, choices, discount), `payment`, `refund` (+ lines, allocations), `document` (+ series, prints), `discount`, `expense`, `audit`, `sequence`, `idempotency`, `domain_event`, `offline_submission`. Existing stubs cover part of this (`staff`, `settings`, `product`, `inventory`, `order`, `payment`, `expense`); add the rest.

### 4.4 `models/` — ORM tables
One class per table in DATABASE.md. No business methods beyond trivial properties. New vs the existing 17 stub files: terminal, session, system_state, stock_level (in `inventory.py`), document + document_series + document_prints (in `receipt.py`), refund (+ lines, allocations), pos_snapshot, offline_submission, domain_event, idempotency_record, sequence, settings_history, media.

### 4.5 `schemas/` — Pydantic DTOs
`XCreate`, `XUpdate`, `XRead`, `XListQuery` per resource; money as decimal strings; enums shared with domain; request bodies never carry authoritative totals (client values are requests only, SR-8). Add schemas for setup, terminal, pos, sync, event, refund and document (existing `receipt.py`).

### 4.6 `routers/`
Thin. Each endpoint: setup gate → `Depends(current_session)` (token, session not ended, idle timeout, terminal active via device credential) → `Depends(require(Permission.X))` → `require_feature(...)` where gated → idempotency (where required) → one service call → schema. Existing router stubs map to API.md sections (`receipts.py` serves `/documents`; refunds live with payments). **Add:** `setup.py`, `terminals.py`, `pos.py`, `sync.py`, `events.py`, `audit.py`.

---

## 5. Cross-system relationships (how a change ripples)

| Change | Ripple |
|---|---|
| Catalog change (product, price, option, recipe, discount, tax class) | New `catalog_version` + `pos_snapshot`; affects **new** orders only. Existing orders/documents keep their snapshots; offline terminals receive it at their next snapshot. |
| Product deactivated / unavailable | Hidden from POS; still visible in history, analytics, archive. Existing reservations are finalized or released as recorded. |
| Product `track_units` / `track_ingredients` changed | New orders only. Completion/cancellation of existing orders finalizes/releases exactly what was reserved at creation (movements reference the order). |
| Recipe edited | Future reservations and cost; existing reservations and past movements unchanged. |
| Ingredient unit cost edited | Future cost calculations; costing method ⚠ OPEN Q-ING-3. |
| Discount edited / deactivated | New orders only; OrderDiscount snapshot unchanged. |
| Tax settings changed | New orders only; orders freeze tax name/rate/mode per class; documents reprint with their original snapshot. |
| Payment method disabled | Not offered for new payments; historical payments keep their method. |
| Cash rounding changed | Future settling cash payments only; stored `rounding_adjustment` unchanged. |
| **Order created** (`POST /orders`) | Reservation movements for all unit + ingredient stock (all-or-nothing; 409 INSUFFICIENT_STOCK) → `order.created`, `stock.changed` (+ `stock.low` / `stock.out`); discount/ID-capture audited. |
| Payment recorded / confirmed / voided | Payment row; `payment_status` recomputed → `payment.recorded` / `payment.confirmed` / `payment.voided`, `order.payment_status_changed`. |
| **Order fully settled** | Sales document issued in the same transaction (number from `document_series`). |
| **Order completed** | Requires `paid`; `sale` movements (on_hand −q, reserved −q) → `order.completed`, `stock.changed`; enters History; auto-archive timer starts. |
| **Order cancelled** (before completion) | `reservation_release` movements → `order.cancelled`, `stock.changed`; audited; stays in the Admin review list until manually archived. Paid/partially paid cancellation ⚠ OPEN Q-CAN-1 (C-19, AR-14). |
| Refund recorded (⚑Refunds) | Refund + lines + allocations; order `refund_status` and document status updated; refund document ⚖ VR-3; restock ⚠ OPEN Q-REF-3 (`sale_reversal`); analytics net sales; `refund.recorded`; audited. |
| Document reprinted | Same number; `print_count` +1; `document_prints` row; audit. |
| Order archived (auto or manual) | `archived_at` set (not a status) → `order.archived`; audited (system actor for auto). |
| Order restored | Back to History (never the active board); excluded from automatic re-archiving → `order.restored`; audited. |
| Settings changed (any section) | `version` +1, `settings_history`, audit, `settings.changed`; pricing-relevant → new `pos_snapshot`. Retention below minimum → 422 RETENTION_BELOW_MINIMUM. |
| Feature disabled (e.g. Inventory) | Module write endpoints → 403 FEATURE_DISABLED; **data kept**. Stock behaviour while disabled ⚠ OPEN Q-FEAT-1; Admin read access ⚠ OPEN Q-FEAT-2. Refunds OFF → refund endpoints 403 FEATURE_DISABLED, UI hides refund actions, historical refunds stay visible (Q-REF-4). |
| Role permission changed | Effective on the next request (server checks every call); audited; `settings.changed`. Admin Mode ⚠ OPEN Q-AUTH-3. Active sessions are not force-ended by a grant change; whether revoking admin access (e.g. `settings.view`) ends an Admin's session (`end_reason` `forced`) is ⚠ OPEN Q-AUTH-3. |
| User deactivated | Active sessions ended (`user_deactivated`) → `session.ended`, `staff.status_changed`; history keeps the name. |
| Terminal deactivated / activation reset / revoked | Device credential revoked (reset issues a new code); sessions on that terminal ended (`terminal_revoked`) → `terminal.status_changed`, `session.ended`; audited. |
| Idle timeout exceeded | Next request ends the session (`idle_timeout`, 401 SESSION_EXPIRED) → `session.ended`. |
| Offline submission committed | Order (`origin = offline`, canonical number), payments, movements, sales document, audit, events — as if performed online at commit time. |
| Offline submission flagged | `needs_review`, nothing applied to stock or money → `sync.review_required`. |
| Setup completed | `system_state = completed`; `/setup/*` closed; audited. |
| Terminology changed | Display labels only; API field names, DB and records unchanged. |
| Staffing limits lowered below current count | Existing accounts/terminals stay; only **new** creations/activations are blocked (409 LIMIT_REACHED). |

---

## 6. Data lifecycles

| Entity | Lifecycle | Never hard-delete when… |
|---|---|---|
| Order | (cart is client-side) → **pending** → **preparing** → **ready** → **completed**; or → **cancelled** from pending/preparing/ready. `payment_status` unpaid → partially_paid → paid (derived). `refund_status` none → partially_refunded → refunded. Archive flag: completed → auto-archived after `archiving.auto_archive_after` (or manually earlier) → restorable by ✱archive.manage within `archiving.restore_window` → History (excluded from auto re-archive; manual re-archive allowed). Cancelled → Admin review list → manual archive (reason). | always (SR-6) |
| Payment | **pending** → **completed** \| **voided** (from pending only); completed is immutable; reversal only via refund | always |
| Refund (+ lines, allocations) | Recorded once (immutable) | always |
| Document | **issued** → **partially_refunded** → **refunded**; **void** only if verified rules allow (⚖ VR-3); reprints add `document_prints` rows | always |
| StockLevel / reservation | available → reserved (`reservation`) → sold (`sale`: on_hand −q, reserved −q) or released (`reservation_release`); manual movements never break the invariants | row kept while the subject exists |
| StockMovement | Written once | always |
| Terminal | **pending_activation** → **active** ⇄ **inactive** → **revoked**; reset activation revokes the credential and returns it to pending_activation with a new code | referenced by sessions/orders/documents (Q-DEL-1) |
| Session | started → active (`last_activity_at`) → ended (`end_reason`) | kept as history |
| OfflineSubmission | **received** → **committed** \| **needs_review** → **resolved**; payload never modified | always |
| SystemState | not_started → in_progress → completed (one-way) | — (singleton) |
| Settings | version n → n+1 (previous versions kept in history) | always (history) |
| AuditLog | Written once | always |
| DomainEvent | written in transaction → published → retained for the replay window | technical data (not business history) |
| PosSnapshot | created per `catalog_version` → retained while any offline submission may reference it | while referenced |
| Product · Category · ChoiceGroup/Option · Ingredient · Discount · User · Terminal | Active ⇄ Inactive; **hard delete only if never referenced**, otherwise deactivate/archive (Q-DEL-1) | referenced by any order, movement, recipe, document, session or audit record |
| Expense | Recorded → Edited (audited) → delete vs void ⚠ OPEN Q-EXP-1 (principle "records affecting history are not hard-deleted" points to void-with-reason) | pending Q-EXP-1 |
| Retention | Records past `archiving.retention_period` are **not disposed** until a verified `compliance.retention_minimum` exists; handling ⚠ OPEN Q-ARC-5 ⚖ VR-6 | always, until Q-ARC-5 |

---

## 7. Settings → system dependencies

All settings are **business-wide** (Q-SET-1). User/terminal security and session state (credentials, sessions, lock state, terminal activation) are separate records, not settings.

| Settings section | Affects |
|---|---|
| **Business** | Document header, POS header, currency symbol everywhere, analytics currency, timezone for "today", business-day boundaries and auto-archive timing. |
| **Branding** | Logo on sidebar/customer screens, theme tokens. Semantic status colours are never overridable. Which logo prints ⚠ OPEN Q-RCP-4 (C-2). |
| **Terminology** | Display labels (Product/Customer/Staff/Order/Category/Receipt) in UI and printed documents. Never API/DB names. Permission key `settings.terminology` Admin-only until Q-SET-3. |
| **Features** | Enables/disables modules: Inventory, Analytics, Expenses, **Refunds** (Q-REF-4: OFF → 403 FEATURE_DISABLED on refund endpoints), Discounts, Ingredient Tracking, Low Stock Alerts, Order Alerts, **Live Updates** (SR-1; precedence with Preferences ⚠ OPEN Q-SET-2), Sound Effects. Disabled tracking behaviour ⚠ OPEN Q-FEAT-1; Admin view of disabled data ⚠ OPEN Q-FEAT-2. |
| **Permissions** | RolePermission grants checked on every endpoint. |
| **Tax** | enabled, name, rate, mode (included/excluded), registration number, display flags → PriceCalculator, order snapshot, document tax lines, analytics. Default: disabled, empty rate. Taxability per product via `tax_class` (Q-TAX-1, ⚖ VR-4). |
| **Payments** | Enabled methods & order; per-method rules (cash received required, auto change, drawer; `require_reference`, confirmation ⚠ OPEN Q-PAY-3); **`cash_rounding` {enabled, increment, mode nearest/down/up}** (Q-PAY-2, ⚖ VR-5; UI later). |
| **Discounts** | Active definitions offered at order creation; rules incl. `requires_identification` / `identification_fields` → PriceCalculator; ⚑Discounts gates the module. The UI "Tax Handling" control is superseded (C-12). |
| **Receipts** | **Complete in the UI. DISPLAY settings only:** printed/digital format, receipt logo, header toggles, transaction-information toggles, heading / thank-you / footer / small-print texts → document rendering. **Compliance must-print locks override display toggles** when set (§13; "Show Tax" overlap with Tax ⚠ OPEN Q-SET-2, C-3). Snapshotted into each document at issue time. |
| **Staffing** | Max admins / staff / terminals → creation & activation limits; Low Stock Threshold → default threshold for new items only (Q-INV-4); alerts use per-item thresholds; Order Waiting Threshold → board highlight and `alert.order_overdue`. |
| **Preferences** | **Business-wide** (Q-SET-1): sounds, notifications & alert types, live updates / auto refresh (⚠ OPEN Q-SET-2, C-5), default order type + show selector, POS behaviour (auto-clear, return to POS, confirmation prompts). Applied on every terminal and user. |
| **Account** | The caller's own name and credential (password or PIN per `auth_method`); session/logout. Not a settings document. |
| **Security** *(backend-first; UI later)* | `idle_timeout_minutes` (allowed list; approved candidates 5, 10, 15, 30, 60) → server session expiry and client idle timer (Q-AUTH-4); credential policy values ⚠ OPEN Q-AUTH-7. ✱settings.security. |
| **Archiving** *(backend-first; UI later)* | `auto_archive_after` → auto-archive job; `restore_window` → restore validation (replaces UI `RESTORE_WINDOW_HOURS = 48`); `retention_period` ≥ `compliance.retention_minimum`. Defaults ⚠ OPEN Q-SET-4. ✱settings.archiving. |
| **Offline** *(backend-first; UI later)* | `enabled`, `sync_review_threshold`, limits (⚠ OPEN Q-TRM-7) → snapshot content, device behaviour, review flagging. Defaults ⚠ OPEN Q-SET-4. ✱settings.offline. |
| **Compliance** *(backend-first; UI later)* | Document types/titles, document series, must-print field locks, reprint marker text, `statutory_rules`, `retention_minimum`, identification display/printing policy. **Every value ⚖** (VR-1…VR-7); see §13. ✱settings.compliance. |

---

## 8. Temporary code inventory (to be replaced, NOT removed in Phase 3B)

**All mock/demo data and temporary in-memory state must be removed or replaced with live backend data during the integration phase. None of it is removed in Phase 3B (SR-10).** Production must never ship or seed it (SR-9).

### 8.1 Mock data files (visible business data — violate the fresh-system rule once real data exists)
| File | What it fakes | Used by | Replace with |
|---|---|---|---|
| `pages/POS/posMockData.ts` | 5 categories, products with photos & choice groups, `mockDiscounts`, `MOCK_VAT_RATE = 0.12` | POS | `GET /pos/catalog` / `pos_snapshot`, discount + tax settings |
| `pages/Orders/ordersMockData.ts` | Orders with customer names, cashiers, payments | Orders board | `GET /orders?status=…` + real-time events |
| `pages/Receipts/receiptsMockData.ts` | Receipts + `mockBusiness` (name, TIN, address, phone) | Receipts, History | `GET /documents`, Business settings |
| `pages/History/historyMockData.ts` | 7 days of transactions, cashiers | History | `GET /history` |
| `pages/Admin/adminOverviewMockData.ts` | Static KPIs, charts, top products, alerts | Admin Overview | `GET /analytics/overview` |
| `components/admin/analytics/analyticsDemoData.ts` | "Sample"-prefixed demo sales (opt-in toggle) | Analytics | real analytics; keep toggle dev-only or remove |
| `components/admin/archived/archivedSampleData.ts` | Sample archive (dev-only switch, excluded from prod build) | Archived Orders | real archive |

### 8.2 Temporary in-memory stores (start empty, reset on reload — correct behaviour, but not persistent)
`stores/catalogStore.ts` (products + product inventory, shared by Products/Inventory/Analytics/Ingredients), `stores/cartStore.ts`, and every settings store: `business-`, `branding-`, `terminology-`, `feature-`, `permission-`, `tax-`, `payment-`, `discount-`, `receipt-`, `staffing-`, `preference-SettingsStore.ts`, `accountStore.ts`. Page-local `useState` lists: Choices, Ingredients (+ recipes), Expenses, Staff, Archived Orders.

### 8.3 Demo-only calculations (must move to backend domain)
- POS totals & VAT (`POSPage.tsx`, VAT-inclusive using `MOCK_VAT_RATE = 0.12`) → `PriceCalculator` with configured tax (no hard-coded rate).
- `utils/receipt.ts` `receiptTotals`, `utils/orderDisplay.ts` `orderTotals`.
- `taxSettingsStore.calculateTax`, `discountSettingsStore.previewDiscount` (preview only; production formulas in BUSINESS-RULES §5–§6).
- Analytics aggregations (`analyticsData.ts` `computeKpis/computeTrend/...`).
- Stock status (`types/inventory.ts stockStatus`), movement balances in `catalogStore`; adjustments clamp stock at 0 (the backend rejects instead, Q-INV-3).
- Archive restore window `RESTORE_WINDOW_HOURS = 48` (`archivedData.ts`) → `archiving.restore_window` (Q-ARC-2, C-10).

### 8.4 Placeholder actions / fake values
- Login screen submit (no auth), sidebar "Staff / Terminal —" identity, "Lock" link → `/login`.
- Account page: identity "Not assigned", password change validates then discards, logout navigates only.
- Staff page: passwords validated then discarded; terminal list `REG-01..03` is a fixed prototype list (`types/auth.ts TERMINALS`) → terminal registry + activation (Q-TRM-1, C-11).
- Receipts/History: print/reprint/refund only mutate local state; refunds are full-amount only.
- Payments/Discounts/Tax/Receipts/etc.: "saved for this session (not stored yet)".
- Features: only Admin tabs show an "Off" tag; nothing is enforced.
- Permissions: configuration only; nothing enforced.
- Settings → Overview card statuses are static (6 Configured / 6 Needs Setup).
- Password rules differ: Staff page (8+, letter, number) vs Account page (8+, number, uppercase) (C-1) — resolved in principle by Q-AUTH-2: **one server-enforced credential policy**; its values are ⚠ OPEN Q-AUTH-7. UI unchanged for now.
- Two separate product type systems: POS `Product` (mock, has `choiceGroups`, `stock`) vs Admin `CatalogProduct` (no choices link). The real model unifies them.
- Admin Choices are not linked to products yet; Ingredients recipes are keyed to catalog products but never consumed.

### 8.5 UI behaviour superseded by Phase 3B decisions (change in a later phase, not now)
| UI today | Decided behaviour | Decision |
|---|---|---|
| POS checkout and Orders PaymentPanel take ONE full payment; POS is pay-first | Order created first (stock reserved), split payments, completion after settlement | Q-ORD-1, Q-PAY-1 (C-7); pay-now option ⚠ OPEN Q-ORD-6 |
| Discounts form "Tax Handling" control | Tax always computed after an ordinary discount; no per-discount tax handling | Q-TAX-2 (C-12) |
| `RESTORE_WINDOW_HOURS = 48` | `archiving.restore_window` setting | Q-ARC-2 (C-10) |
| Fixed terminal list REG-01…03 | Admin registry + device activation | Q-TRM-1 (C-11) |
| Login has no PIN mode, no terminal activation, no setup wizard | Flexible auth, device activation, first-run wizard | Q-AUTH-2, Q-TRM-1, Q-AUTH-1 |
| No Settings screens for security / archiving / offline / compliance | Backend sections exist; UI in a later phase | Q-AUTH-4, Q-ARC-1..3, Q-TRM-2..5, Q-RCP-2 |
| History refunds full-only | Full and partial refunds | Q-REF-1 (C-6) |
| No ID-capture fields in the discount selector | Identification fields when the discount requires them | Q-DSC-3 |
| No offline indicator / queue UI | Offline mode, queue count, sync status, review warnings | Q-TRM-2..5 |
| No cash rounding UI | `payments.cash_rounding` | Q-PAY-2 |

---

## 9. Decision status (summary — [DECISIONS.md](DECISIONS.md) is the source of truth)

**DECIDED (30) — 2026-09-27, Phase 3B owner approval:**
Q-ORD-1 · Q-INV-1 · Q-INV-2 · Q-INV-3 · Q-PAY-1 · Q-PAY-2 · Q-REF-4 · Q-REF-1 · Q-DSC-1 · Q-DSC-2 · Q-DSC-3 · Q-TAX-1 · Q-TAX-2 · Q-TAX-3 · Q-RCP-1 · Q-RCP-2 · Q-ARC-1 · Q-ARC-4 · Q-ARC-2 · Q-ARC-3 · Q-AUTH-1 · Q-AUTH-2 · Q-AUTH-4 · Q-TRM-1 · Q-TRM-2 · Q-TRM-3 · Q-TRM-4 · Q-TRM-5 · Q-SET-1 · Q-DEL-1.

**OPEN (40)** — ★ = blocks the related implementation:
- Carried from Phase 3A (30): Q-ORD-2 · Q-ORD-3 · Q-ORD-4 · Q-ORD-5 ⚖ · Q-INV-4 · Q-ING-2 · Q-ING-3 · Q-ING-4 · **Q-PAY-3 ★** · Q-PAY-4 · **Q-REF-2 ★** ⚖ · Q-REF-3 · **Q-CAN-1 ★** · Q-DSC-4 · Q-RCP-3 ⚖ · Q-RCP-4 · Q-EXP-1 · Q-EXP-2 · Q-AUTH-3 · Q-AUTH-5 · Q-TRM-6 · Q-SET-2 · Q-SET-3 · Q-FEAT-1 · Q-FEAT-2 · Q-BUS-1 · **Q-ARCH-1 ★** · Q-ARCH-2 · **Q-ARCH-3 ★** · Q-ARCH-4.
- New in Phase 3B (10): Q-ORD-6 · **Q-REF-5 ★** · **Q-RCP-5 ★** ⚖ · Q-ARC-5 ⚖ · Q-AUTH-6 · **Q-AUTH-7 ★** · **Q-AUTH-8 ★** · **Q-TRM-7 ★** · **Q-TRM-8 ★** · **Q-SET-4 ★**.

**Crosswalk note:** the owner's brief reused some Phase 3A IDs. Canonical meanings now: Q-AUTH-1 = setup wizard, Q-AUTH-2 = flexible authentication, Q-AUTH-4 = idle timeout, Q-TRM-2 = limited offline, Q-TRM-6 = staff terminal restriction (old Q-TRM-2), Q-TAX-2 = tax after discount, Q-TAX-3 = rounding policy; Q-OFF-1 is retired (use Q-TRM-2). Full table in [DECISIONS.md](DECISIONS.md).

---

## 10. Real-time architecture

### 10.1 Principles
- **Server authoritative** (SR-2). Clients may apply an optimistic update for responsiveness; the server response (and the events that follow) replace it. On rejection the client reverts and shows the error reason.
- Events describe **committed** facts only; nothing is published for a rolled-back transaction.
- Events are **notifications, not the data source**: a client that misses or doubts an event refetches the entity from the API.

### 10.2 Events (SR-1)

The "Delivered to" column summarises intent; the authoritative per-session delivery filter is PERMISSIONS §5.3 (a session receives an event only if it passes that filter).

| Event | Channel | Trigger | Delivered to (permission) |
|---|---|---|---|
| `order.created` | orders | `POST /orders` commit; offline submission committed | ✱orders.view, ✱pos.view |
| `order.status_changed` | orders | `POST /orders/{id}/status` | ✱orders.view |
| `order.cancelled` | orders | `POST /orders/{id}/cancel` | ✱orders.view |
| `order.completed` | orders | completion (settled) | ✱orders.view, ✱history.view |
| `order.archived` / `order.restored` | orders | manual archive, auto-archive job, restore | ✱history.view, ✱archive.manage |
| `order.payment_status_changed` | orders | payment status recomputed | ✱orders.view |
| `payment.recorded` / `payment.confirmed` / `payment.voided` | payments | `POST /orders/{id}/payments`, confirm, void | ✱orders.view, ✱pos.processPayments |
| `refund.recorded` | payments | `POST /orders/{id}/refunds` | ✱receipts.view, ✱history.view |
| `stock.changed` | inventory | any stock movement | ✱inventory.view / ✱ingredients.view (full levels); ✱pos.view (availability only) |
| `stock.low` / `stock.out` | alerts | threshold crossing (⚑Low Stock Alerts) | ✱inventory.view; `stock.out` availability to ✱pos.view |
| `alert.order_overdue` | alerts | overdue-order check (Order Waiting Threshold; ⚑Order Alerts) | ✱orders.view |
| `settings.changed` | settings | `PUT /settings/{section}`, permission grants | all sessions (section + version only; clients refetch what they may see) |
| `terminal.status_changed` | terminals | register, activate, deactivate, reset, revoke | ✱terminals.manage; the affected device |
| `session.started` / `session.ended` | sessions | login, logout, lock, idle timeout, forced end | ✱staff.view; the affected session |
| `staff.status_changed` | staff | staff activate/deactivate, role change | ✱staff.view |
| `sync.review_required` | sync | offline submission → `needs_review` | ✱sync.review |

### 10.3 Envelope
`event_id` (UUID) · `sequence` (per-business, strictly increasing) · `type` · `entity_type` · `entity_id` · `entity_version` · `occurred_at` · `actor_id` · `terminal_id` · `payload`.
Payloads are **minimal and permission-filtered**: identifiers, new status/version and summary fields only. Never ID numbers or other identification data, credentials, credential hashes, device secrets or unit costs to roles without the permission.

### 10.4 Transactional outbox
1. The service writes its business change, audit row(s) and `domain_events` row(s) in **one transaction**; the per-business `sequence` is assigned in that transaction.
2. After commit, the **outbox dispatcher** reads unpublished events in `sequence` order and publishes them to connected clients (per channel, filtered per session permissions).
3. Delivery is at-least-once; ordering is by `sequence`. Published events are retained for a replay window (technical parameter).

### 10.5 Client rules
- Track `last_sequence`; apply an event only if its `entity_version` is newer than the local copy; **dedupe by `event_id`**.
- A gap in `sequence` → replay `GET /events?after_sequence=<last>`.
- Reconnect → resume the stream from `last_sequence`. If the requested point is beyond the replay window → **409 RESYNC_REQUIRED** → client refetches its working sets (open orders, stock, settings) and continues from the current sequence.

### 10.6 Presence
Terminal and staff presence come from `session.started` / `session.ended` plus connection heartbeats that update `terminals.last_seen_at`. Heartbeats and background refresh **do not** update `sessions.last_activity_at` (Q-AUTH-4). `POST /sync/status` is the device queue heartbeat (§12).

### 10.7 Transport and toggles
- Transport ⚠ OPEN **Q-ARCH-3**: SSE (`GET /events/stream`) or WebSocket (`/ws`). Requirements: authenticated with the session, resumable from `last_sequence`, per-channel subscription, server-side permission filtering, heartbeat. A database realtime channel with **direct client access would require row-level security** and bypasses the backend's filtering — see ⚠ OPEN Q-ARCH-1.
- Features → Live Updates vs Preferences → Live Updates & Auto Refresh precedence ⚠ OPEN **Q-SET-2**. Events are always written to the outbox (needed for replay and sync); the toggles only govern client delivery.
- **Polling fallback**: when the stream is unavailable or live updates are off, clients refresh through the normal list endpoints (Auto Refresh) and `GET /events?after_sequence=`.

---

## 11. Concurrency & consistency

| Area | Mechanism | Failure result |
|---|---|---|
| **Inventory** | One DB transaction per use case; lock all affected `stock_levels` rows in a **deterministic order** (subject_type, subject_id); conditional updates (`reserved + q ≤ on_hand`); check constraints `on_hand ≥ 0`, `reserved ≥ 0`, `reserved ≤ on_hand` as last defence; bounded retry on deadlock/serialization failure; never silently overwrite. | 409 INSUFFICIENT_STOCK (offending items) · 409 STOCK_RESERVED |
| **Orders** | `orders.version` + server state-machine guard; order row locked (row lock, SELECT … FOR UPDATE) for transitions; clients send `expected_version`; completion checks status **and** settlement under the lock → no double completion. | 409 INVALID_TRANSITION · 409 VERSION_CONFLICT · 409 ORDER_NOT_SETTLED |
| **Payments / refunds** | Idempotency-Key → `idempotency_records` (key, scope, `request_hash`, stored response) written in the same transaction; order row locked while computing remaining balance (total − completed − **pending**) or refundable amount (Σ completed `amount` − Σ refunds). | 422 IDEMPOTENCY_KEY_REUSED · 422 OVERPAYMENT · 422 REFUND_EXCEEDS_REFUNDABLE |
| **Sequences / document numbers** | `sequences` and `document_series` rows locked inside the issuing transaction; order numbers may have gaps; document numbers gap-free within a series as a design goal (⚖ VR-3). | rollback releases the lock; no number is issued |
| **Settings** | `version` on every write; stale version rejected. | 409 VERSION_CONFLICT |
| **Offline submissions** | Unique `client_txn_id`; duplicate returns the stored outcome. | — (idempotent) |
| **Events** | Written in the transaction, published only after commit (§10.4). | — |

**Lock order** (avoid deadlocks): order row → `stock_levels` rows (sorted) → `sequences` / `document_series` rows. Idempotency-Key is required on `POST /orders`, `POST /orders/{id}/payments`, `POST /orders/{id}/refunds`, `POST /orders/{id}/cancel`, `POST /orders/{id}/status` (target completed) and inventory/ingredient restock & adjust.

### 11.1 Walkthrough — two terminals reserve the last unit
1. Product P (`track_units`): `on_hand = 1`, `reserved = 0`. REG-01 and REG-02 each send `POST /orders` for 1 × P at the same moment.
2. Both transactions lock the `stock_levels` row for P; REG-01 gets it first, REG-02 waits.
3. REG-01: available 1 ≥ 1 → `reserved = 1`, `reservation` movement, order created, outbox rows (`order.created`, `stock.changed`, `stock.out`) → commit → lock released.
4. REG-02: reads `reserved = 1`, available 0 → **409 INSUFFICIENT_STOCK** (P listed) → rollback (no order number was drawn: stock is locked and checked before the order sequence, per the lock order).
5. REG-02 reverts its optimistic order, shows the reason; both terminals receive `stock.out` and mark P unavailable.

### 11.2 Walkthrough — payment request retried after a timeout
1. Cashier records a cash payment; client sends `POST /orders/{id}/payments` with Idempotency-Key K. The server commits payment + idempotency record (K, request_hash, response), but the response is lost.
2. Client retries with the **same K and body** → server finds K, `request_hash` matches → returns the stored response; **no second payment**.
3. If the retry arrives while the first is still running → 409 CONFLICT (key in progress); the client retries later with the same K and then receives the stored outcome.
4. Same K with a different body → 422 IDEMPOTENCY_KEY_REUSED.
5. If the client mistakenly uses a new key → the remaining-balance check (under the order lock, including pending payments) rejects it with 422 OVERPAYMENT only when the duplicate exceeds the remaining balance; a duplicate partial payment within the balance is accepted as a new payment. Clients must therefore generate the key once per payment attempt, persist it, and reuse it for every retry until a final response.

---

## 12. Offline architecture

Limited offline operation (Q-TRM-2, Q-TRM-3), **cash only** (Q-TRM-4), queued with a review threshold (Q-TRM-5). Enabled by `offline.enabled` (default ⚠ OPEN Q-SET-4).

### 12.1 Components
| Component | Role |
|---|---|
| Installable web app shell + service worker | Loads the POS without the network. |
| IndexedDB local snapshot | Last synchronized `pos_snapshot` + stock levels + settings. |
| IndexedDB append-only queue | Offline transactions and their local stock effects; entries removed only after server confirmation. |
| Device credential | From terminal activation; identifies the terminal on sync. |

### 12.2 Snapshot (`GET /sync/snapshot`)
`pos_snapshot` with `catalog_version` (products, options, recipes for availability, active discounts, tax, payments incl. cash rounding), relevant business-wide settings (preferences, `security.idle_timeout_minutes`, `offline` limits), stock levels (available per subject), `taken_at`. Refreshed whenever online and on `settings.changed` / catalog changes.

### 12.3 Capability matrix (Q-TRM-3)
| Allowed offline | Not available offline | To confirm — ⚠ OPEN Q-TRM-7 |
|---|---|---|
| Continue an already-authenticated session on an activated terminal | GCash / Card / Bank Transfer (Q-TRM-4) | Discounts offline (esp. ID-capture discounts) |
| Create orders from the last synchronized snapshot | Refunds | New sign-in while offline |
| Cash payments | Cancelling or paying orders created online | Reprint offline |
| Local stock tracking that blocks sales when local available stock is insufficient | Restock / adjustments | Offline limits (max duration / queued count / value) |
| Local status changes for orders created offline on that terminal | Catalog, settings, staff, terminal changes; archive/restore; analytics; expenses; terminal activation | Status changes on online orders |
| Print a provisional slip | | |

### 12.4 Local stock, references and slips
- Local available = snapshot available − local effects of queued offline orders; a sale is blocked locally when insufficient. Every local stock effect is recorded in the queue entry (SR-5). Global accuracy cannot be guaranteed while several terminals are offline (AR-1).
- Each offline order gets a device-generated `client_txn_id` (UUID) and a human-readable `offline_ref` for the slip. Neither is an order number nor a document number; the canonical order number is assigned at commit.
- Offline sales document numbering ⚠ OPEN **Q-RCP-5** ⚖ VR-3. Until resolved an offline sale prints only a **provisional slip that is not a sales document**; the sales document is issued when the transaction is committed at sync (AR-2).

### 12.5 Queue entry content
`client_txn_id` · `offline_ref` · terminal (from device credential) · user_id and session reference · `captured_at` (device clock) · `snapshot_version` (`catalog_version`) · order lines (product/option IDs, quantities), order type, tag, note · discount (if allowed, Q-TRM-7) · cash payments (amount, tendered) · local status changes · local stock effects · client-computed totals (for comparison only, never trusted) · attempts.

### 12.6 Sync protocol (SR-4)
1. Device sends queued transactions in capture order: `POST /sync/transactions`.
2. Server persists the raw submission in `offline_submissions` (`received`; unique `client_txn_id`).
3. Idempotency: a duplicate `client_txn_id` returns the stored outcome.
4. Validate: terminal activated at capture and not revoked since; user existed and was active at capture and not deactivated since; required permissions held at capture and still held at sync (anything revoked since capture → `needs_review`, LEDGER §11); snapshot version is retained; prices recomputed from the server's stored `pos_snapshot`; discount valid; cash only.
5. Validate inventory / payment / order state under locks (§11).
6. Commit: order (`origin = offline`, canonical number) in the status it reached offline; `reservation` movements always; `sale` movements only if the order was completed offline; the recorded cash payments; a sales document only if those payments fully settle the order (otherwise it is issued later by the settling payment); audit; events → `committed`.
7. Client marks the entry synced and removes it from the queue. When the server returns `needs_review`, the server holds the raw submission and resolution moves to Admin review: the device marks the entry "handed over — under review", stops retrying it, keeps it read-only for display, and no longer counts it as unsynced for the sign-out/clear block.
8. Any conflict (e.g. insufficient server stock, price mismatch, unknown snapshot, user/terminal no longer valid, non-cash method) → `needs_review` with `conflict_reasons`; **nothing applied to stock or money**; `sync.review_required`.

### 12.7 Review threshold (Q-TRM-5)
If a transaction is not committed within `offline.sync_review_threshold` (time since capture and/or failed attempts), it is flagged `needs_review` for an Admin — server-side when received/attempted, and as a device-side warning. `POST /sync/status` reports the device queue (count, oldest `captured_at`) so Admins can see unsynced terminals.

### 12.8 Admin reconciliation
`GET /sync/reviews`, `GET /sync/reviews/{id}`, `POST /sync/reviews/{id}/resolve` (✱sync.review). Resolution is an explicit, audited decision recorded in `resolution`, `resolved_by/at` (and the resulting order_id if committed). The original submission is **never modified**; nothing is silently merged; stock corrections happen only through explicit movements and never make stock negative (Q-INV-3).

### 12.9 Clock skew
`captured_at` is device time and untrusted; both `captured_at` and `received_at` are stored. The business-day attribution rule for offline sales is not yet defined (AR-5).

### 12.10 Security and durability
- Only the already-authenticated session continues offline; new offline sign-in ⚠ OPEN Q-TRM-7 (would need cached verifiers, AR-3; credential policy ⚠ OPEN Q-AUTH-7).
- The idle timeout is enforced **locally** from `security.idle_timeout_minutes` (the server cannot enforce offline, AR-3); the server re-validates the session on reconnect.
- Storage durability (AR-6): request persistent storage, block sign-out/clearing while unsynced entries exist, show the queue count, sync as soon as the network returns.
- Clearing browser storage removes the device credential (terminal must be re-activated); a copied credential could clone a terminal → reset activation and `last_seen_at` monitoring (AR-7).

---

## 13. Compliance-ready architecture

BrewSync is **compliance-ready, not compliant by default**: rules that may be required are configuration, kept separate from ordinary display settings, and must be verified (⚖) before production (SR-11). Nothing in BrewSync claims BIR or other legal compliance. The primary sales document title/type is configured, not assumed.

| Area | Architecture |
|---|---|
| **Display vs compliance** | `receipts` = display choices (format, logo, toggles, texts). `compliance` = document types/titles, series, must-print field locks, reprint marker text, statutory rules, retention minimum, identification display/printing policy. When a compliance lock is set, it **overrides** the corresponding display toggle. |
| **Document types & series** | `document_type` `sales` / `refund`; titles from compliance settings. `document_series`: format template, scope business or terminal, start number, optional allocated range, reset policy. `DocumentNumberAllocator` allocates inside the issuing transaction with a row lock; gap-free within a series as a technical design goal. Reprint keeps the number, increments `print_count`, writes `document_prints` + audit, prints the configured marker. Refund documents, void rules and offline issuance (Q-RCP-5) ⚖ VR-3. Pre-payment slip/bill ⚠ OPEN Q-RCP-3. |
| **Must-print field locks** | `FieldLockSet` from compliance settings is applied when the document snapshot is built; locked fields cannot be hidden by display toggles. Which fields are mandatory is **not** decided here (⚖ VR-3). |
| **Statutory rules extension point** | `compliance.statutory_rules`: each rule carries verification metadata (`verified_by`, `verified_at`, `verification_reference`) and is **disabled by default**; it cannot be enabled without complete verification metadata. When enabled it plugs into `PriceCalculator` through `StatutoryPricingPolicy` — never through ordinary discount logic. No statutory formula is defined in these docs (Q-DSC-2, ⚖ VR-1, AR-17). |
| **Tax classes** | `products.tax_class` baseline `taxable` / `non_taxable`; one configured tax (default disabled, empty rate); any further classes are compliance configuration; tax after ordinary discount; one rounding policy (Q-TAX-1..3, ⚖ VR-4, AR-18). |
| **Cash rounding** | `payments.cash_rounding {enabled, increment, mode}`; explicit `rounding_adjustment` on the payment; document line per display/compliance settings; values are configuration, not facts (Q-PAY-2, ⚖ VR-5). |
| **Retention** | `archiving.retention_period` ≥ `compliance.retention_minimum` (entered only after verification; lower → 422 RETENTION_BELOW_MINIMUM); longer requirement wins; **nothing disposed until a verified minimum exists**; end-of-retention handling ⚠ OPEN Q-ARC-5 (Q-ARC-3, ⚖ VR-6, VR-7, C-18). |
| **Identification data** | `order_discounts.customer_name` / `id_type` / `id_number` stored only when the discount requires them; visible only to authorized roles; masked in lists; never in events or audit diffs; printing is a compliance setting; no field claimed legally mandatory (Q-DSC-3, ⚖ VR-2, VR-7). |

**Verification register** (details and status in [DECISIONS.md](DECISIONS.md)): VR-1 Senior Citizen/PWD statutory treatment · VR-2 identification/recordkeeping · VR-3 invoicing/sales document requirements · VR-4 tax treatment · VR-5 cash rounding · VR-6 data retention · VR-7 privacy/data protection · VR-8 refund/consumer-protection documentation.

---

## 14. Architectural risks

| ID | Risk | Impact | Mitigation / related decision |
|---|---|---|---|
| AR-1 | Offline × inventory: simultaneous offline terminals sell the same last units | Physical sale already happened; server stock cannot absorb it | Local blocking, `needs_review`, Admin reconciliation; Q-INV-3 forbids committing into negative stock (§12) |
| AR-2 | Offline × sales documents: series numbers cannot be allocated centrally offline | Provisional slips may not satisfy requirements | Q-RCP-5 ⚖ VR-3 must be resolved before offline sales issue sales documents |
| AR-3 | Offline × authentication / idle timeout | Server cannot enforce offline; cached verifiers enable PIN brute force on a stolen device | Session continuation only, local idle timer; Q-TRM-7, Q-AUTH-7 |
| AR-4 | Offline × server-authoritative pricing | Server cannot reproduce offline totals | Retain `pos_snapshots`; mismatch → review |
| AR-5 | Device clock skew | Wrong business day / ordering | Store `captured_at` + `received_at`; attribution rule needed |
| AR-6 | Browser storage eviction | Unsynced queue lost | Persistent storage, block sign-out/clear with unsynced items, visible count, sync ASAP |
| AR-7 | Device credential in a browser | Clearing storage de-activates; copying clones a terminal | Reset activation; `last_seen_at` monitoring |
| AR-8 | Setup wizard hijack on a network-reachable fresh install | Attacker becomes first Admin | Q-AUTH-8 |
| AR-9 | PIN brute force | Account takeover | Rate limit, lockout, terminal-bound PIN login (Q-AUTH-7) |
| AR-10 | Reservation at creation + pay later | Abandoned unpaid orders hold stock indefinitely | Stale-unpaid-order alert/review needed (no auto-cancel decided) |
| AR-11 | Physical loss while stock is reserved | Adjustment below reserved rejected → friction | Admin cancels/handles affected orders first (409 STOCK_RESERVED) |
| AR-12 | Retention vs never-hard-delete (C-18) | Unbounded growth / conflicting obligations | Nothing disposed until verified; Q-ARC-5 |
| AR-13 | Auto-archive vs restore | Restored orders immediately re-archived | Restored orders excluded from auto re-archive |
| AR-14 | Refunds OFF + paid-not-completed cancellation | Orders stuck | Q-CAN-1 (C-19) |
| AR-15 | Two terminals collecting payment for the same order | Overpayment / duplicates | Order row lock + Idempotency-Key + remaining balance incl. pending (§11) |
| AR-16 | Real-time delivery gaps / data leakage | Stale boards; exposure of sensitive data | Per-business sequence, replay, RESYNC_REQUIRED; permission-filtered minimal payloads (§10) |
| AR-17 | Statutory discount layer vs one-discount rule and tax pipeline | Wrong totals if enabled unverified | Separate `StatutoryPricingPolicy`, disabled until VR-1 verified |
| AR-18 | Pro-rata discount allocation across taxable/non-taxable lines | Technical rule may differ from requirements | Verify (VR-4); single allocation point |
| AR-19 | Brief / Phase 3A ID and letter mismatch | Misapplied decisions | Crosswalk in DECISIONS.md; external notes may still use old IDs |
| AR-20 | UI still encodes superseded behaviour | Integration surprises | §8.5 list; revise in the integration phase |
