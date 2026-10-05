# BrewSync — Proposed Data Model

> **Status: Phase 3B (2026-09-27)** — business rules and architecture finalized; decision status lives in [DECISIONS.md](DECISIONS.md).
> **Descriptive only — no tables, SQL, DDL or migrations are created.** Column lists below are a design description; types are indicative.
>
> Target: **PostgreSQL**. Hosting and access path (Supabase-hosted vs self-hosted; backend-only vs direct client access) **⚠ OPEN (Q-ARCH-1)**. File storage: **Supabase Storage** (Q-ARCH-2 decided) — the database keeps only public URLs.
>
> Conventions: `id uuid PK`; every business table has `business_id FK`; `created_at` / `updated_at timestamptz` (stored UTC, reported in the business timezone); money `numeric(12,2)` (decimal, 2 dp, one rounding policy — Q-TAX-3); quantities `numeric(12,3)` (product unit quantities are whole numbers); unit costs `numeric(12,4)`; soft state via `active` / `status` columns; history tables are **append-only**; every multi-table use case writes in **one DB transaction**.
>
> Markers: ★ high priority · ⚖ requires legal/business verification (VR-ID) · ⚠ OPEN not decided · ✱ permission · ⚑ feature gate.
>
> Companion documents: [DECISIONS.md](DECISIONS.md) · [BUSINESS-RULES.md](BUSINESS-RULES.md) · [SYSTEM-LOGIC.md](SYSTEM-LOGIC.md) · [USER-FLOWS.md](USER-FLOWS.md) · [PERMISSIONS.md](PERMISSIONS.md) · [API.md](API.md)

---

## 1. Entity-relationship overview

```
SystemState (singleton: setup_status)
Business 1─* User *─1 Role 1─* RolePermission *─1 Permission
Business 1─* Terminal 1─* Session *─1 User
Business 1─* Category 1─* Product
Product 1─0..1 StockLevel ; Ingredient 1─1 StockLevel        [stock_levels: subject_type, subject_id]
Product *─* ChoiceGroup (ProductChoiceGroup) ; ChoiceGroup 1─* ChoiceOption
Product 1─0..1 Recipe 1─* RecipeLine *─1 Ingredient
StockMovement *─1 (Product | Ingredient)                     [subject_type, subject_id]
StockMovement *─0..1 (Order | Refund | OfflineSubmission)     [reference_type, reference_id; manual = none]
Business 1─* PosSnapshot (per catalog_version)
Order *─1 Terminal, *─1 Session, *─1 User(cashier)
Order 1─* OrderItem 1─* OrderItemChoice
Order 1─0..1 OrderDiscount *─1 Discount
Order 1─* Payment
Order 1─* Refund 1─* RefundLine *─1 OrderItem
          Refund 1─* RefundAllocation *─1 Payment
Order 1─0..1 Document (sales document, issued at full settlement)
Refund 1─0..1 Document (refund document, ⚖ VR-3)
Document *─1 DocumentSeries ; Document 1─* DocumentPrint
Order 1─0..1 OfflineSubmission (committed submission → resulting order)
OfflineSubmission *─1 Terminal, *─1 User, *─1 PosSnapshot(snapshot_version)
Business 1─* Expense *─1 User(recorded_by)
Business 1─* SettingsDocument (one per section) 1─* SettingsHistory
Business 1─* Sequence
Business 1─* DomainEvent (outbox, per-business sequence)
Business 1─* IdempotencyRecord (key per scope)
AuditLog *─0..1 User (null = system actor), *─0..1 Terminal
```

## 2. Tables

### 2.1 Identity & access
| Table | Key columns | Notes |
|---|---|---|
| **businesses** | name, type, custom_type, tagline, address, phone, email, currency_code, currency_symbol, timezone | One row per deployment (multi-branch **⚠ OPEN Q-BUS-1**). **Created by the owner in the setup wizard** (Q-AUTH-1), never seeded. Tax registration number lives in `tax` settings; other document-identity fields in `compliance` settings (⚖ VR-3). |
| **system_state** | setup_status (`not_started` / `in_progress` / `completed`), setup_started_at null, setup_completed_at null, setup_completed_by null | Singleton row. Seeded `not_started` (SR-9). While ≠ `completed` only `/setup/*` and `/health` work (409 SETUP_REQUIRED); after `completed` `/setup/*` returns 409 SETUP_ALREADY_COMPLETED. Complete Setup = one atomic transaction (business row + first Admin + `completed` + audit). Wizard protection **⚠ OPEN Q-AUTH-8**. |
| **roles** | key (`admin` / `cashier`) unique, name, is_system | Seeded system data (not business data). Custom roles out of scope. |
| **permissions** | key unique, group, label, protected bool | Seeded from the code catalogue (48 keys + gap keys, PERMISSIONS §2). Gap keys Admin-only until **⚠ OPEN Q-SET-3**. |
| **role_permissions** | role_id, permission_key, granted bool, updated_by, updated_at | PK (role_id, permission_key). Default grants seeded; changes audited (SR-7). |
| **users** | code unique/business, full_name, username unique/business (`^[a-z0-9._-]{3,20}$`), role_id, **auth_method** (`password` / `pin`), **password_hash** null, **pin_hash** null, **failed_attempts**, **locked_until** null, **must_change_credential**, **credential_set_at**, default_terminal_id null, status (`active` / `inactive`), last_active_at | Q-AUTH-2: Admin ⇒ `auth_method = password` (422 AUTH_METHOD_NOT_ALLOWED); Cashier `password` or `pin`, chosen by an Admin. The hash matching `auth_method` must be present. Lockout → 423 ACCOUNT_LOCKED; policy values **⚠ OPEN Q-AUTH-7**. No default or shipped password. `default_terminal_id` is a sign-in preference; restriction **⚠ OPEN Q-TRM-6**. Username rename **⚠ OPEN Q-AUTH-5**. Never hard-deleted once referenced (Q-DEL-1). |
| **terminals** | code unique/business, name, status (`pending_activation` / `active` / `inactive` / `revoked`), **activation_code_hash** null, **activation_expires_at** null, **device_credential_hash** null, **activated_at** null, **activated_by** null, registered_at, last_seen_at | Q-TRM-1: Admin registers (✱terminals.manage) → one-time, short-lived activation code (shown once, stored hashed) → device activates → device credential issued (secret on the device, hash here). Terminal identity at login comes from the device credential, never a client-supplied code. Reset activation revokes the credential and issues a new code. Active count ≤ Staffing → Maximum Active Terminals (checked at activation/reactivation). First device / Admin access without a terminal **⚠ OPEN Q-TRM-8**. |
| **sessions** | user_id, terminal_id, started_at, **last_activity_at**, ended_at null, **end_reason** null (`logout` / `lock` / `idle_timeout` / `forced` / `user_deactivated` / `terminal_revoked`), refresh_token_hash | Q-AUTH-4: `last_activity_at` updated on user-initiated requests only (not realtime heartbeats or background refresh); a session idle longer than `security.idle_timeout_minutes` is ended with `idle_timeout` (401 SESSION_EXPIRED). User/terminal security state is separate from business preferences (Q-SET-1). Index (user_id, ended_at). Concurrent sessions per user **⚠ OPEN Q-AUTH-6**; whether `terminal_id` may be null depends on **Q-TRM-8**. |

### 2.2 Catalog & stock
| Table | Key columns | Notes |
|---|---|---|
| **categories** | name unique/business, **code_prefix** (2–5 chars, uppercase, letter first; unique/business; fixed after creation — renaming never changes it), sort_order, active | Cannot be removed while products reference it (reassign first). |
| **products** | code unique/business (uppercase; **generated `PREFIX-NNN`** from the category's `code_prefix` + counter `product:<category_id>`, min. 3 digits; immutable; kept when the product moves category; legacy manual codes such as `AMERICANO` stay valid), name, description, category_id, price ≥ 0, image_url (public Supabase Storage URL set only by `POST /products/{id}/image`; null = placeholder; no migration — existing VARCHAR(500)), available, active, **track_units** bool, **track_ingredients** bool, **tax_class** (`taxable` / `non_taxable`), deleted_at null | Q-INV-1: two independent flags (either, both, neither); **no `stock_mode`**. `track_units` ⇒ one `stock_levels` row; `track_ingredients` ⇒ recipe consumption. Q-TAX-1: taxability per product; further classes are compliance configuration (⚖ VR-4). Soft delete (`deleted_at`) once referenced (Q-DEL-1). Behaviour when the gating feature is disabled **⚠ OPEN Q-FEAT-1**. |
| **stock_levels** | subject_type (`product` / `ingredient`), subject_id, **on_hand**, **reserved**, low_stock_threshold, last_restocked_at | Replaces Phase 3A `product_stock` and `ingredients.stock_quantity`. `available = on_hand − reserved` (computed). One row per subject (unique). Changed **only** through `stock_movements` in the same transaction, under a row lock (§4.5). Stock status in/low/out is computed, not stored (BUSINESS-RULES §3). Threshold default for new subjects = Staffing → Low Stock Threshold (Q-INV-4, decided); per-row value authoritative. The reference may be modelled as two typed nullable FKs with an exactly-one check so the database enforces it. |
| **choice_groups** | code, name, display_name, description, selection_type (`single` / `multi`), required, min_select, max_select, active | Check `min_select ≤ max_select`. |
| **choice_options** | group_id, name, price_delta ≥ 0, is_default, active, sort_order | Ingredient modifiers **⚠ OPEN Q-ING-2** (no column until decided). |
| **product_choice_groups** | product_id, group_id, sort_order | PK (product_id, group_id). |
| **ingredients** | code, name unique/business (case-insensitive), category, unit (`g` / `kg` / `ml` / `L` / `pcs`), unit_cost ≥ 0 `numeric(12,4)`, notes, active | Stock and threshold live in `stock_levels`. Used in any recipe ⇒ deactivate only. Costing method **⚠ OPEN Q-ING-3**. |
| **recipes** | product_id unique, updated_by | Consumption per one unit of the product. |
| **recipe_lines** | recipe_id, ingredient_id, quantity > 0 `numeric(12,3)` | Unique (recipe_id, ingredient_id). Quantity in the ingredient's unit; conversion **⚠ OPEN Q-ING-4**. |
| **stock_movements** | subject_type, subject_id, type, **delta_on_hand**, **delta_reserved**, **on_hand_after**, **reserved_after**, unit_cost null, reason null, note null (≤ 200), reference_type null (`order` / `refund` / `offline_submission` / `manual`), reference_id null, actor_id, terminal_id null | Append-only ledger; corrections are new rows. Index (subject_type, subject_id, created_at). Movement types and signs: table below. |
| **pos_snapshots** | catalog_version unique/business, payload (catalog, prices, choice groups, discounts, tax/payment/offline settings), created_at | The bundle sent to terminals (`GET /sync/snapshot`). **Retained** so the server can recompute offline totals from the exact snapshot an offline transaction used (SR-4, AR-4). Current stock levels are sent alongside by `GET /sync/snapshot` with `taken_at`; they are not stored in the retained snapshot. |

**Stock movement types** (Q-INV-2, Q-INV-3)

| Type | Δ on_hand | Δ reserved | Typical reference |
|---|---|---|---|
| `initial` | + (set once at creation) | 0 | manual |
| `restock` | + (with `unit_cost`) | 0 | manual |
| `adjustment` | ± (reason Damaged / Lost / Other) | 0 | manual |
| `correction` | ± (count correction) | 0 | manual / offline_submission (Admin reconciliation) |
| `waste` | − | 0 | manual |
| `reservation` | 0 | + q | order (created) |
| `reservation_release` | 0 | − q | order (cancelled before completion) |
| `sale` | − q | − q | order (completed — reservation becomes the sale) |
| `sale_reversal` | + | 0 | refund (restock on refund **⚠ OPEN Q-REF-3**) |

A movement that would break `on_hand ≥ 0`, `reserved ≥ 0` or `reserved ≤ on_hand` is **rejected, never clamped** (409 INSUFFICIENT_STOCK / 409 STOCK_RESERVED).

### 2.3 Sales
| Table | Key columns | Notes |
|---|---|---|
| **orders** | number unique/business, terminal_id, session_id, cashier_id, customer_name null, order_type (`dine_in` / `takeout` / `delivery`), tag null, note null, **status** (`pending` / `preparing` / `ready` / `completed` / `cancelled`), **payment_status** (`unpaid` / `partially_paid` / `paid`), **refund_status** (`none` / `partially_refunded` / `refunded`), **origin** (`online` / `offline`), **offline_ref** null, **version** int, subtotal, discount_total, net_amount, tax_name, tax_rate, tax_mode, tax_amount, **tax_breakdown** (frozen per `tax_class`: taxable amount, tax amount), total, idempotency_key null, started_at, ready_at, completed_at, cancelled_at, cancel_reason (≤ 200), **archived_at** null, **archived_by** null (null = system), **archive_method** null (`auto` / `manual`), **archive_reason** null, **restored_at** null, **restored_by** null | Q-ORD-1: unpaid orders are valid active orders; `payment_status` is server-derived and separate from `status`. Totals computed and frozen by the server at creation (SR-2, SR-8); `tax_amount` = Σ per-class tax in `tax_breakdown` (Q-TAX-2, ⚖ VR-4). `number` from the business order sequence (gaps from rolled-back transactions acceptable). `version` incremented on every change (409 VERSION_CONFLICT on stale). `offline_ref` = the device-generated, human-readable provisional reference printed on the offline slip (distinct from `client_txn_id`; the link to the submission is `offline_submissions.order_id`). Archive is a flag, not a status (Q-ARC-1/4). `restored_at` set ⇒ excluded from automatic re-archiving. Customer name/record **⚠ OPEN Q-ORD-5** ⚖ VR-7; tag required? **⚠ OPEN Q-ORD-4**; edit after placement **⚠ OPEN Q-ORD-2**. Never deleted. |
| **order_items** | order_id, product_id (FK, kept even if product soft-deleted), product_code, product_name, quantity (whole number > 0), unit_price, line_total, tax_class, discount_allocation | Snapshots. `tax_class` frozen from the product; `discount_allocation` = the line's pro-rata share of the order discount (largest-remainder, sums exactly — Q-TAX-2, ⚖ VR-4). |
| **order_item_choices** | order_item_id, option_id null, group_name, option_name, price_delta | Snapshots. |
| **order_discounts** | order_id **unique**, discount_id, name, type, value, eligibility, eligibility_label, min_order, max_discount, amount, requires_identification, **customer_name** null, **id_type** null, **id_number** null, applied_by, approved_by null | Q-DSC-1: at most one row per order (409 DISCOUNT_ALREADY_APPLIED). **No `tax_handling`** (C-12). Q-DSC-3: identification columns filled only when the discount definition requires them (422 IDENTIFICATION_REQUIRED if missing); sensitive (§5) ⚖ VR-2, VR-7. Approval **⚠ OPEN Q-DSC-4**. Statutory treatment is a separate compliance rule (Q-DSC-2, SYSTEM-LOGIC §13) — the data recorded when it applies is designed after verification ⚖ VR-1. |
| **payments** | order_id, method (`cash` / `gcash` / `card` / `bank_transfer`), **amount** > 0, **tendered** null, **change_given** null, **rounding_adjustment** (default 0), reference null (4–40 chars), status (`pending` / `completed` / `voided`), confirmed_by null, confirmed_at null, terminal_id, user_id, **idempotency_key**, **origin** (`online` / `offline`) | Q-PAY-1: several payments per order, each an immutable record once `completed`; `voided` only from `pending`. Settlement: Σ completed (`amount` + `rounding_adjustment`) = order `total`. New payment ≤ remaining balance (total − completed − pending; 422 OVERPAYMENT). Cash: `tendered` ≥ `amount` (422 INSUFFICIENT_TENDER), `change_given = tendered − amount` (server-computed). Non-cash: exact amount, no tendered/change; reference when the method requires it (422 REFERENCE_REQUIRED). Q-PAY-2: `rounding_adjustment = remaining − collected`, non-zero only on a cash payment settling the full remaining balance while cash rounding is enabled ⚖ VR-5. Offline payments are cash only (Q-TRM-4). Confirmation meaning **⚠ OPEN Q-PAY-3**; other methods **⚠ OPEN Q-PAY-4**. |
| **refunds** | order_id, document_id (the order's sales document), amount > 0, reason, restocked bool, approved_by null, user_id, terminal_id, idempotency_key | Q-REF-1: full or partial; separate immutable record; amount computed by the server; Σ refunds ≤ Σ completed payment `amount` (422 REFUND_EXCEEDS_REFUNDABLE). Only for `completed` orders; ⚑ Refunds toggle (Q-REF-4, 403 FEATURE_DISABLED when off; history stays visible). Original order, payments and document snapshot never edited; `orders.refund_status` and `documents.status` updated. Extra approval **⚠ OPEN Q-DSC-4 / Q-AUTH-3**; method & time limit **⚠ OPEN Q-REF-2** ⚖ VR-8; restock **⚠ OPEN Q-REF-3**. |
| **refund_lines** | refund_id, order_item_id, quantity > 0, amount | What is being refunded. Granularity (by line/quantity vs arbitrary amount) **⚠ OPEN Q-REF-5**. |
| **refund_allocations** | refund_id, payment_id, amount > 0, method, reference null | Which payment(s) the refund returns (replaces single `refunds.payment_id`). Σ allocations = refund amount; per payment Σ allocations ≤ payment `amount`. Allocation across split payments **⚠ OPEN Q-REF-2**. |
| **documents** | document_type (`sales` / `refund`), series_id, number, order_id, refund_id null, issued_at, issued_by, terminal_id, status (`issued` / `partially_refunded` / `refunded` / `void`), snapshot (title, header, lines, discount, tax display, payments incl. rounding line, cashier, terminal, footer, configured compliance fields), print_count, last_printed_at | Neutral **sales document** (UI label "Receipt"); title/type configured in `compliance`, never assumed (Q-RCP-2) ⚖ VR-3. Sales document issued in the transaction that fully settles the order; at most one `sales` document per order. `number` allocated from the series inside the issuing transaction under a row lock; separate from `orders.number` (Q-RCP-1). Snapshot immutable. `void` only if verified rules allow ⚖ VR-3. Refund documents and their numbering ⚖ VR-3. Offline sales get only a provisional slip until committed at sync (**⚠ OPEN Q-RCP-5** ⚖ VR-3). |
| **document_series** | code unique/business, document_type, format_template, scope (`business` / `terminal`), terminal_id null, start_number, next_number, range_end null, reset_policy, active | Defined through the `compliance` settings section (✱settings.compliance); every value ⚖ VR-3. Optional allocated ranges via `range_end`. Gap-free within a series is a technical design goal. `next_number` changes only by issuance under a row lock; a series that has issued numbers is not re-formatted — a new series replaces it. |
| **document_prints** | document_id, print_number, is_reprint, printed_by, terminal_id, printed_at | One row per print. Reprint keeps the original number, increments `documents.print_count`, writes a row here + an audit record; never a new transaction or number (Q-RCP-1). Reprint marker text from `compliance` ⚖ VR-3. |
| **discounts** | name unique/business, type (`percentage` / `fixed`), value, eligibility (`all` / `senior` / `pwd` / `student` / `custom`), custom_eligibility, min_order null, max_discount null, **requires_identification** bool, **identification_fields** (subset of customer name, ID type, ID number), active, sort_order | **No `tax_handling`** (Q-TAX-2 supersedes it for ordinary discounts; C-12). Senior Citizen / PWD are ordinary definitions (Q-DSC-2) ⚖ VR-1. No field claimed legally mandatory ⚖ VR-2. Deactivate once applied (Q-DEL-1). |

### 2.4 Back office
| Table | Key columns | Notes |
|---|---|---|
| **expenses** | code unique/business (`EXP-YYYY-NNN`), category, description (≤ 120), amount > 0, expense_date (date), payment_method, notes (≤ 500), recorded_by, voided_at null, void_reason null | Categories fixed list (**⚠ OPEN Q-EXP-2**). Delete vs void **⚠ OPEN Q-EXP-1** (principle points to void-with-reason). |
| **settings_documents** | section, data (validated by a typed schema per section), version int, updated_by, updated_at | Unique (business_id, section). All sections **business-wide** (Q-SET-1). Writes send `version` (stale → 409 VERSION_CONFLICT), are audited and copied to `settings_history`. Sections: table below. |
| **settings_history** | section, version, data, updated_by, updated_at | Append-only. |
| **sequences** | name ≤ 64 (`order`, `expense:2026`, `staff`, `product:<category_id>` …), next_value | Incremented with a row lock inside the owning transaction. Sales document numbers use `document_series`, not this table. |
| **audit_logs** | actor_id null (null = system actor), terminal_id null, action, entity_type, entity_id, before, after, ip, user_agent, created_at | Append-only, immutable (SR-7). Records the ID-capture **event**, never the ID value; never credentials. Read ✱audit.view. |
| **media** (optional) | url/path, content_type, size, uploaded_by | Product images, business/receipt logo (which prints **⚠ OPEN Q-RCP-4**). Not implemented as a table: product images live in Supabase Storage (bucket `product-images`, Q-ARCH-2) and are referenced by `products.image_url`. Binary image data is never stored in PostgreSQL (no bytea/base64); objects are WEBP/PNG/JPEG ≤ 3 MB at `{business_id}/{product_id}/{uuid}.{ext}`. |

**Settings sections** (`settings_documents.section`)

| Section | Content | Notes |
|---|---|---|
| `business` · `branding` · `terminology` · `features` · `staffing` · `preferences` | Existing UI sections | `features` holds the Refunds toggle (Q-REF-4). `preferences` business-wide (Q-SET-1). Overlaps **⚠ OPEN Q-SET-2**. |
| `tax` | enabled, name, rate, mode (included/excluded), registration number, display flags | Default **disabled, no rate**; rate is configuration, never hard-coded ⚖ VR-4. |
| `payments` | per-method enable & rules (reference, confirmation, cash received, auto change, drawer), **`cash_rounding`** { enabled, increment, mode `nearest` / `down` / `up` } | ≥ 1 method enabled. Rounding values are configuration ⚖ VR-5. |
| `receipts` | Display only (complete in the UI): printed/digital format, receipt logo, header toggles, transaction-info toggles, heading / thank-you / footer / small-print texts | Compliance field locks override display toggles when set. |
| `security` *(new, no UI yet)* | `idle_timeout_minutes` (allowed list; candidates 5, 10, 15, 30, 60), credential policy | Policy values **⚠ OPEN Q-AUTH-7**. ✱settings.security |
| `archiving` *(new)* | `auto_archive_after`, `restore_window`, `retention_period` | `retention_period` ≥ `compliance.retention_minimum` (422 RETENTION_BELOW_MINIMUM) ⚖ VR-6. ✱settings.archiving |
| `offline` *(new)* | `enabled`, `sync_review_threshold`, limits | Limits **⚠ OPEN Q-TRM-7**. ✱settings.offline |
| `compliance` *(new)* | document types/titles, document series, must-print field locks, reprint marker text, `statutory_rules` (disabled by default, verification metadata), `retention_minimum` (entered only after verification), identification display/printing policy | Separate from `receipts` display settings. Every value ⚖ (VR-1…VR-7). ✱settings.compliance |

Permission grants are `role_permissions` rows; discounts are `discounts` rows; Account is the caller's own `users` row. Default values for the new settings **⚠ OPEN Q-SET-4**.

### 2.5 Sync & real-time
| Table | Key columns | Notes |
|---|---|---|
| **offline_submissions** | client_txn_id unique/business, offline_ref, terminal_id, user_id, captured_at (device clock), received_at (server), snapshot_version, payload, status (`received` / `committed` / `needs_review` / `resolved`), attempts, conflict_reasons null, resolution null, resolved_by null, resolved_at null, order_id null | SR-4: the raw submission is persisted first and never modified. Duplicate `client_txn_id` returns the stored outcome. Commit sets `order_id` (order `origin = offline`, `offline_ref` copied from the submission). Conflict or threshold exceeded (`offline.sync_review_threshold`) → `needs_review`; nothing applied to stock or money until an Admin resolves it (✱sync.review, audited). `captured_at` is untrusted (AR-5). Never deleted (SR-6). |
| **idempotency_records** | key, scope, request_hash, response, created_at | Unique (business_id, scope, key). Same key + same request → stored response; same key + different request → 422 IDEMPOTENCY_KEY_REUSED. Required on order creation, payments, refunds, cancel, completion, restock & adjust. Stored responses mask identification values. |
| **domain_events** | event_id, sequence, type, entity_type, entity_id, entity_version, occurred_at, actor_id, terminal_id, payload, published_at null | Outbox (SR-1): written in the same transaction as the change, published after commit. `sequence` monotonic per business in commit order, so replay by `after_sequence` never skips an event; beyond the replay window → 409 RESYNC_REQUIRED. Payloads minimal and permission-filtered (never ID numbers, credentials, or costs to roles without the permission). Transport **⚠ OPEN Q-ARCH-3**. |

## 3. Enumerated values

| Column | Values |
|---|---|
| `orders.status` | `pending` · `preparing` · `ready` (label "Ready for Pickup") · `completed` · `cancelled` |
| `orders.payment_status` | `unpaid` · `partially_paid` · `paid` (server-derived) |
| `orders.refund_status` | `none` · `partially_refunded` · `refunded` |
| `orders.origin` / `payments.origin` | `online` · `offline` |
| `orders.archive_method` | `auto` · `manual` |
| `payments.status` / `payments.method` | `pending` · `completed` · `voided` / `cash` · `gcash` · `card` · `bank_transfer` |
| `documents.document_type` / `documents.status` | `sales` · `refund` / `issued` · `partially_refunded` · `refunded` · `void` |
| `terminals.status` | `pending_activation` · `active` · `inactive` · `revoked` |
| `sessions.end_reason` | `logout` · `lock` · `idle_timeout` · `forced` · `user_deactivated` · `terminal_revoked` |
| `users.auth_method` / `users.status` | `password` · `pin` / `active` · `inactive` |
| `offline_submissions.status` | `received` · `committed` · `needs_review` · `resolved` |
| `system_state.setup_status` | `not_started` · `in_progress` · `completed` |
| `stock_movements.type` | `initial` · `restock` · `adjustment` · `correction` · `waste` · `reservation` · `reservation_release` · `sale` · `sale_reversal` |
| `stock_movements.reference_type` | `order` · `refund` · `offline_submission` · `manual` |
| `products.tax_class` | `taxable` · `non_taxable` (baseline; more classes via compliance ⚖ VR-4) |

State transitions are validated by the server (BUSINESS-RULES §1; 409 INVALID_TRANSITION).

## 4. Integrity rules the schema must support

### 4.1 Foreign keys
- Foreign keys everywhere, `ON DELETE RESTRICT` for every history-bearing reference (order_items→products, movements→subjects, payments/refunds/documents→orders, refund_allocations→payments, documents→document_series, sessions/orders→terminals & users, etc.).

### 4.2 Check constraints (last line of defence; the service validates first)
- Stock: `on_hand ≥ 0`, `reserved ≥ 0`, `reserved ≤ on_hand` (Q-INV-3).
- Prices ≥ 0 (`products.price`, `choice_options.price_delta`); money totals ≥ 0; `discount_total ≤ subtotal`.
- Quantities > 0 (order items, recipe lines, refund lines); restock quantity > 0; adjustment delta ≠ 0 with reason.
- Discount ranges: percentage 0 < value ≤ 100; fixed value > 0; `max_discount` > 0 or null; fixed ⇒ `max_discount` ≥ value; `custom` eligibility ⇒ label; `requires_identification` ⇒ at least one identification field.
- `min_select ≤ max_select`.
- Payments: `amount > 0`; cash ⇒ `tendered ≥ amount` and `change_given ≥ 0` (= tendered − amount); non-cash ⇒ no tendered/change and `rounding_adjustment = 0`.
- Refunds / allocations: amount > 0.
- Orders: `completed` ⇒ `payment_status = paid`; archive columns only on `completed` / `cancelled` orders; `archive_method` set iff `archived_at` set.
- Users: the hash for the selected `auth_method` present.
- Unit cost ≥ 0; low-stock threshold ≥ 0.

### 4.3 Uniqueness (per business)
Product code · category name · ingredient name · discount name · username · user code · terminal code · order number · document number per series · expense code · `client_txn_id` · idempotency key per scope (also `payments.idempotency_key`). Plus: one `stock_levels` row per subject · one `order_discounts` row per order · one `sales` document per order · one `settings_documents` row per section · `recipes.product_id` · (recipe_id, ingredient_id) · (product_id, group_id) · (role_id, permission_key) · `pos_snapshots.catalog_version` · `domain_events.sequence`. Names are compared case-insensitively.

### 4.4 Service-enforced invariants (under an order row lock)
- Σ refunds ≤ Σ completed payment `amount`; Σ allocations per payment ≤ that payment's `amount`.
- Settlement: Σ completed (`amount` + `rounding_adjustment`) = `total` before completion (409 ORDER_NOT_SETTLED); new payments ≤ remaining balance incl. pending.
- `payment_status`, `refund_status` and `documents.status` recomputed in the same transaction as the payment/refund.
- Reservation all-or-nothing across every unit and ingredient subject of the order (409 INSUFFICIENT_STOCK with offending items).
- Admin accounts use `password`; ≥ 1 active Admin always (BUSINESS-RULES §13).
- `archiving.retention_period ≥ compliance.retention_minimum`.

### 4.5 Row locking (SR-3)
- `stock_levels` — locked in a deterministic subject order for reservation, release, sale, restock, adjustment; conditional updates; no silent overwrite.
- `orders` — locked for status changes, payments, refunds, cancellation and completion (no double completion; `version` checked).
- `sequences` and `document_series` — locked while allocating a number inside the issuing transaction.
- Locks are taken in one fixed order in every use case (SYSTEM-LOGIC §11).

### 4.6 Row-level security
Only needed if clients access the database directly (an option of **⚠ OPEN Q-ARCH-1**). With backend-only access, the service scopes every query by `business_id` (BUSINESS-RULES §0).

## 5. Sensitive columns

| Column(s) | Handling |
|---|---|
| `users.password_hash`, `users.pin_hash` | Strong adaptive hash; never returned by any API, never in events, audit before/after or logs. |
| `terminals.device_credential_hash`, `terminals.activation_code_hash`, `sessions.refresh_token_hash` | Hash only; plaintext shown once (activation code) or kept only on the device. |
| `order_discounts.id_number` (+ `customer_name`, `id_type`) | Personal data: stored only when the discount requires it; access-restricted to authorized roles; masked in lists and exports; never in real-time events or audit values; printed on documents only per the compliance identification policy; encryption at rest to be considered ⚖ VR-2, VR-7. |
| `orders.customer_name`, `offline_submissions.payload`, `documents.snapshot` | May contain personal data; same masking/access rules ⚖ VR-7 (Q-ORD-5). |
| `users.full_name`, `users.last_active_at`, `sessions` timestamps, `audit_logs.ip`, `audit_logs.user_agent` | Staff personal/usage data: access-restricted (✱staff.view / ✱audit.view); retention per Q-ARC-3 / Q-ARC-5 ⚖ VR-6, VR-7. |

## 6. History preservation, deletion & retention

**Never hard-delete (SR-6):** `orders` (incl. completed & cancelled), `order_items`, `order_item_choices`, `order_discounts`, `payments`, `refunds`, `refund_lines`, `refund_allocations`, `documents`, `document_prints`, `stock_movements`, `audit_logs`, `settings_history`, `offline_submissions` (and `pos_snapshots` referenced by them).

**Configuration objects (Q-DEL-1):** products, categories, ingredients, choice groups/options, discounts, staff accounts (`users`), terminals — hard delete only if never referenced; otherwise deactivate / archive (`active = false`, `status`, `deleted_at`). Expenses **⚠ OPEN Q-EXP-1**.

**Archive ≠ delete:** archiving sets the archive columns only; the order stays in reports and search (BUSINESS-RULES §12). Automatic archiving is a scheduled job for `completed` orders (system actor, audited); cancelled orders are archived manually with a reason.

**Retention (Q-ARC-3):** `archiving.retention_period` must be ≥ the verified `compliance.retention_minimum`; where requirements demand longer, the longer period applies. **No disposal is performed until a verified minimum is configured.** End-of-retention handling (keep / export-then-purge / anonymize) **⚠ OPEN Q-ARC-5** ⚖ VR-6, VR-7. No legal period is stated in these docs. Technical tables (`idempotency_records`, `domain_events` beyond the replay window) are not business history.

## 7. Initial (production) data

Initialization seeds **only** (SR-9): `roles`, `permissions` (catalogue), default `role_permissions` grants, default `settings_documents` with neutral values (tax **disabled, no rate**), `sequences` and a **default neutral `document_series`** at their start values, and `system_state.setup_status = not_started`.

The `businesses` row and the first Admin user are created **by the owner in the setup wizard** (Q-AUTH-1) — not seeded, no default password.

**Nothing else:** no products, categories, choices, ingredients, stock, orders, payments, documents, expenses, customers, discounts, analytics or fake staff. Frontend mock/demo data (SYSTEM-LOGIC §8) is temporary UI data, never written to the database (SR-10).

## 8. Changes from the Phase 3A model (C-16)

| Phase 3A | Phase 3B |
|---|---|
| `products.stock_mode` enum | `track_units` + `track_ingredients` (Q-INV-1) |
| `product_stock`, `ingredients.stock_quantity` / `low_stock_threshold` | `stock_levels` with `on_hand` / `reserved` (Q-INV-2) |
| `stock_movements.delta` / `balance_after` | `delta_on_hand`, `delta_reserved`, `on_hand_after`, `reserved_after`; new types `reservation`, `reservation_release` |
| One payment per order; `cash_received` | Split payments (Q-PAY-1); `tendered`, `rounding_adjustment`, `origin` |
| `orders.payment_status` incl. refund values | `payment_status` + `refund_status` + `origin` + `offline_ref` + `version` + archive/restore columns |
| `refunds.payment_id`, `refunds.method` | `refund_lines` + `refund_allocations` (Q-REF-1) |
| `receipts` table, `order 1─1 receipt`, `receipt` sequence | `documents` + `document_series` + `document_prints` (Q-RCP-1/2) |
| `discounts.tax_handling`, `order_discounts.tax_handling` / `evidence` | Removed (Q-TAX-2); `requires_identification`, `identification_fields`; `customer_name` / `id_type` / `id_number` (Q-DSC-3) |
| `users.must_change_password` / `password_set_at` | `auth_method`, `pin_hash`, `failed_attempts`, `locked_until`, `must_change_credential`, `credential_set_at` (Q-AUTH-2) |
| `terminals.device_key_hash` | Activation code + device credential columns; new statuses (Q-TRM-1) |
| `sessions.last_active_at` | `last_activity_at`, extended `end_reason` (Q-AUTH-4) |
| Preferences possibly per user | Business-wide (Q-SET-1); new sections `security`, `archiving`, `offline`, `compliance` |
| — | New: `system_state`, `pos_snapshots`, `offline_submissions`, `idempotency_records`, `domain_events` |

## 9. Open items that affect the data model

| Q-ID | Effect on the model |
|---|---|
| Q-ARCH-1 ★ | Hosting; RLS needed only with direct client access |
| Q-ARCH-2 / Q-RCP-4 | `media` storage; which logo prints |
| Q-ARCH-3 ★ | Event transport (outbox unchanged) |
| Q-BUS-1 | Branch scoping of every table |
| Q-REF-5 ★ / Q-REF-2 ★ ⚖ VR-8 / Q-REF-3 | `refund_lines` use; allocation & method; `sale_reversal` on refund |
| Q-CAN-1 ★ | Money returned on cancelling a paid / partially paid order |
| Q-PAY-3 ★ / Q-PAY-4 | Meaning of `confirmed_*`; method enum vs table |
| Q-RCP-3 ⚖ / Q-RCP-5 ★ ⚖ VR-3 | Pre-payment slip; offline document numbering |
| Q-ARC-5 ⚖ VR-6 | End-of-retention handling |
| Q-AUTH-6 / Q-AUTH-7 ★ / Q-AUTH-8 ★ / Q-TRM-8 ★ | Concurrent sessions; credential policy; wizard protection; `sessions.terminal_id` nullability |
| Q-TRM-6 / Q-TRM-7 ★ | Terminal restriction; offline limits |
| Q-ORD-2 / Q-ORD-3 / Q-ORD-4 / Q-ORD-5 ⚖ VR-7 | Item edits; per-type statuses; `tag` requirement; customer record |
| Q-ING-2 / Q-ING-3 / Q-ING-4 | Option modifiers; costing; unit conversion |
| Q-INV-4 / Q-FEAT-1 / Q-FEAT-2 | Threshold default; disabled-tracking behaviour; Admin view |
| Q-DSC-4 / Q-AUTH-3 | `approved_by` use |
| Q-EXP-1 / Q-EXP-2 | Expense void vs delete; category table |
| Q-AUTH-5 / Q-SET-2 / Q-SET-3 / Q-SET-4 ★ | Username rename; overlapping settings; permission keys; default values of new settings |
