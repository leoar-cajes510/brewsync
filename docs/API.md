# BrewSync — Planned API

> **Status: Phase 3B (2026-09-27)** — business rules and architecture finalized. **Implementation status (2026-10-03): §0 lists exactly what is built.** Sections 1–6 remain the planned contract; where they differ from §0, §0 describes the running backend and the difference is marked **As built**. This document describes the API contract in prose and tables; it contains no FastAPI code, SQL or migrations.
> Decision status lives in [DECISIONS.md](DECISIONS.md). Related: BUSINESS-RULES (rules behind every endpoint) · SYSTEM-LOGIC §4 (layers), §10 (real-time), §11 (concurrency), §12 (offline), §13 (compliance) · [PERMISSIONS.md](PERMISSIONS.md) (request pipeline, event filtering) · [DATABASE.md](DATABASE.md) (tables named here).
> Markers: ★ high priority · ⚖ requires legal/business verification · ⚠ OPEN not decided · ✱ permission · ⚑ feature gate. Every endpoint lists its ✱ and ⚑; the **server enforces both** on every call (SR-2).

---

## 0. As built (2026-10-03)

Base path `/api/v1` (except `GET /health`). Every endpoint below exists; anything in §3 that is not listed here is **planned, not implemented**.

| Area | Implemented endpoints |
|---|---|
| Health | `GET /health` |
| Setup | `GET /setup/status` · `POST /setup/complete` (one request: business, admin, security, settings) · `POST /setup/first-terminal` |
| Auth | `POST /auth/login` · `POST /auth/logout` · `POST /auth/lock` · `GET /auth/me` · `PATCH /auth/me` · `POST /auth/change-password` · `POST /auth/change-pin` |
| Terminals | `GET /terminals` · `POST /terminals` · `PATCH /terminals/{id}` · `POST /terminals/{id}/deactivate` · `POST /terminals/{id}/reset-activation` · `POST /terminals/activate` |
| Staff | `GET /staff` · `POST /staff` · `PATCH /staff/{id}` · `POST /staff/{id}/activate` · `POST /staff/{id}/deactivate` · `POST /staff/{id}/reset-credential` · `GET /staff/{id}/activity` |
| Catalog | `GET/POST /categories` · `PATCH /categories/{id}` · `GET/POST /products` · `PATCH/DELETE /products/{id}` · `GET/PUT /products/{id}/recipe` · `GET/POST /choice-groups` · `PATCH /choice-groups/{id}` |
| Discounts | `GET/POST /discounts` · `PATCH /discounts/{id}` · `POST /discounts/{id}/activate` · `POST /discounts/{id}/deactivate` |
| Inventory | `GET /inventory` · `PATCH /inventory/{product_id}` (threshold) · `POST /inventory/{product_id}/restock` · `POST /inventory/{product_id}/adjust` · `GET /inventory/{product_id}/movements` |
| Ingredients | `GET/POST /ingredients` · `PATCH /ingredients/{id}` (incl. `active`) · `PATCH /ingredients/{id}/threshold` · `POST /ingredients/{id}/restock` · `POST /ingredients/{id}/adjust` · `GET /ingredients/{id}/movements` |
| POS | `GET /pos/menu` |
| Orders | `POST /orders/quote` · `POST /orders` · `GET /orders?status=a,b` · `GET /orders/{id}` · `POST /orders/{id}/status` · `POST /orders/{id}/cancel` |
| Payments / refunds | `POST /orders/{id}/payments` · `POST /orders/{id}/payments/{payment_id}/confirm` · `POST /orders/{id}/payments/{payment_id}/void` · `POST /orders/{id}/refunds` |
| Documents | `GET /documents` · `GET /documents/{id}` · `POST /documents/{id}/reprint` |
| History / archive | `GET /history?include_archived=` · `GET /history/{order_id}` · `GET /archive` · `POST /archive` · `POST /archive/{order_id}/restore` |
| Expenses | `GET/POST /expenses` · `PATCH /expenses/{id}` |
| Analytics | `GET /analytics/sales?start=&end=` |
| Settings | `GET /settings` · `GET /settings/operational` · `GET/PUT /settings/{section}` · `GET/PUT /settings/permissions` |
| Audit | `GET /audit?entity_type=&action=&limit=` |

**Planned in §3 but not implemented:** `POST /auth/refresh` (no refresh cookie; sessions end on idle timeout) · `POST /auth/unlock` (after `POST /auth/lock` the same user signs in again with `POST /auth/login`; the UI pre-fills the username) · `POST /setup/business`, `POST /setup/admin` · `POST /terminals/{id}/reactivate` · `GET /staff/{id}` · `DELETE /categories/{id}` · `POST /products/{id}/duplicate` (the UI duplicates with `POST /products`) · `POST /products/{id}/activate|deactivate` (use `PATCH /products/{id}` with `active`) · `POST /settings/branding/logo` (the logo is stored with the branding settings) · `PUT /products/{id}/choice-groups` (links are sent with the product) · `GET /orders/{id}/refunds` (refunds are in the order DTO) · `PATCH /orders/{id}` · `GET /pos/catalog` (built as `GET /pos/menu`) · `GET /history/export.csv` · `POST /expenses/{id}/void`, `DELETE /expenses/{id}` (Q-EXP-1) · `DELETE /discounts/{id}` · the 8 analytics aggregation endpoints (built as one raw feed) · `/sync/*` · `/events/*` · `/payments/{id}/confirm|void` (built under `/orders/{id}/payments/…`).

### 0.1 Contract details that differ from or add to §1–§4
- **Errors.** Every error, including malformed request bodies/queries, uses the §1.3 envelope. Request-shape errors are `422 VALIDATION_ERROR` with `message` = the first problem (e.g. `lines.0.quantity: Input should be a valid integer…`) and `details.fields` = `[{field, message}]`; submitted values are never echoed. Values PostgreSQL cannot store (NUL character, numeric overflow) → `422 VALIDATION_ERROR`. Malformed values inside otherwise valid bodies (unknown enum such as tax `mode`, more than 2 decimals in an amount) → `422`, never `500`.
- **Text fields** (names, descriptions, notes, reasons, usernames, credentials, codes): must be JSON strings; `null`/missing = empty; any other type (number, object, list) → `422 VALIDATION_ERROR`.
- **Boolean fields** (`active`, `available`, `required`, `is_default`, `track_units`, `track_ingredients`, `requires_identification`, tax `enabled`, payment-method options): must be JSON `true`/`false`; `null`/missing = unchanged (edits) or the default (creates); text such as `"false"` or numbers → `422 VALIDATION_ERROR`.
- **List fields** (`options`, recipe `lines`): must be lists of objects, else `422`.
- **`PUT /products/{id}/recipe`** replaces the whole recipe and **requires `lines`** (send `[]` to clear); missing `lines` → `422`. `track_ingredients: true` needs at least one line; an empty recipe switches it off.
- **`POST /ingredients`** requires a non-empty `code` (the UI sends the next `ING-NN`); missing/empty → `422`.
- **`POST /archive`** with an empty `order_ids` → `422` (✱archive.manage is checked first: a Cashier gets `403`).
- **`POST /orders` and `POST /orders/quote`:** a product whose category is inactive is refused (`422 VALIDATION_ERROR`, "… is not available (its category is inactive)").
- **`POST /auth/change-password` / `change-pin`:** wrong current credential → **`422 VALIDATION_ERROR`** ("Current credential is incorrect"); the session stays valid (401 is reserved for real session failures).
- **`GET /pos/menu`** (✱pos.view): `{categories, products, choice_groups, discounts, stock}`. `discounts` is `[]` while ⚑Discounts is off. Tax/payment settings are not included (see `/settings/operational`).
- **`GET /settings/operational`** (any signed-in session, no ✱settings.view): read-only `{section: {section, configured, version, data}}` for `features`, `payments`, `branding`, `terminology`, `preferences`, plus `staffing` limited to `{order_waiting_minutes}` (limits stay private). Security, archiving, offline and compliance are never included.
- **`GET /analytics/sales?start=YYYY-MM-DD&end=YYYY-MM-DD`** (✱analytics.view, ⚑Analytics): raw feed `{start, end, timezone, sales: [{id, number, at, total (net of refunds), refunded, channel, payment, lines: [{product, code, category, qty, price, cost}]}], expenses: [{date, category, amount}]}`; day boundaries in the business timezone; the UI aggregates. `expenses` is `[]` while ⚑Expenses is off.
- **Setup token (Q-AUTH-8) and first terminal (Q-TRM-8 option c).** `POST /setup/complete` and `POST /setup/first-terminal` require header `X-Setup-Token` equal to the server's `SETUP_TOKEN` (≥ 16 characters, constant-time compare). No valid token configured on the server → `503 SETUP_TOKEN_NOT_CONFIGURED`; wrong/missing header → `403 SETUP_TOKEN_INVALID`. `POST /setup/complete` → `201` including `first_terminal` `{…terminal, activation_code, activation_expires_at}` (code shown once, stored hashed, lifetime `FIRST_TERMINAL_CODE_MINUTES`, default 15). `POST /setup/first-terminal` re-issues a code only while **no** terminal is active (else `409`). After setup, `POST /setup/complete` → `409 SETUP_ALREADY_COMPLETED`.
- **Staffing limits:** Max Administrators also applies to promoting a user to Admin and to re-activating an Admin (`409 LIMIT_REACHED`).
- **`GET /audit`:** filters `entity_type`, `action`, `limit` (1–500, default 100). `ingredient.updated` records `before`/`after` of the changed fields only; a no-op edit writes no entry.
- **Order DTO** adds `cashier_id`, `cashier_name`, `archived_by`, `archive_reason`; `GET /archive` returns `{archived: [… + archived_by_name], cancelled_review: […]}` without filters.
- **`GET /documents`, `GET /history`** take no filters (the UI filters); `GET /history?include_archived=true` includes archived orders.

---

## 1. Conventions

### 1.1 Transport, identity & authentication

| Topic | Rule |
|---|---|
| Base path / format | `/api/v1`; JSON request and response bodies (UTF-8). Product images are uploaded as a raw binary body (`Content-Type: image/png|jpeg|webp`), stored in Supabase Storage (Q-ARCH-2 decided). |
| Access token | `Authorization: Bearer <access token>` — short-lived, bound to one server-side `sessions` row. |
| Refresh | httpOnly, secure cookie → `POST /auth/refresh` issues a new access token. A refresh is **not** user activity: it does not update `sessions.last_activity_at` and fails with 401 `SESSION_EXPIRED` once the idle timeout has passed (§1.8). |
| Device credential | `X-Device-Credential: <secret>` on **every** request from a terminal (login and all authenticated calls). Issued once by `POST /terminals/activate` (Q-TRM-1 ★); the server stores only its hash (`terminals.device_credential_hash`). The terminal identity is **derived from this credential — never from a client-supplied terminal code or id**. Missing/invalid/revoked credential, or terminal not `active` → 403 `TERMINAL_NOT_ACTIVATED`. |
| Unauthenticated endpoints | `GET /health`, `/setup/*` (guarded by setup state, §1.7; wizard protection ⚠ OPEN Q-AUTH-8 ★), `POST /terminals/activate` (guarded by the one-time activation code), `POST /auth/login` (credentials + device credential). |
| Sign-in method | `users.auth_method` ∈ {`password`, `pin`} (Q-AUTH-2 ★). Admin → password only; Cashier → password or PIN as selected per account by an Admin. The server accepts only the account's selected method; PIN sign-in only from an activated terminal. |
| Server authority | Totals, prices, stock, discounts, taxes, permissions, payment status, change and refund amounts sent by a client are **never trusted**; the server recomputes from stored/configured data (SR-2, SR-8). Client-entered payment `amount` / `tendered` are *requests* validated against server-computed balances. |
| Time | Timestamps ISO 8601 in UTC; date filters, "today" and business-day boundaries use the Business timezone (BUSINESS-RULES §0). |
| Scoping | Every request is scoped to the single business of the deployment (multi-branch ⚠ OPEN Q-BUS-1). |

The full ordered request pipeline (setup guard → session → idle timeout → device credential → user active → activity update → ⚑ → ✱ → idempotency → service → commit + outbox) is defined in PERMISSIONS §5.2 and applies to every endpoint below.

### 1.2 Money & quantities

- Money is sent and returned as **decimal strings with 2 dp** (`"165.00"`), never JSON numbers/floats. Currency comes from Business settings.
- One server-side Money module and one rounding policy (Q-TAX-3): half-up to 0.01 at the defined points only (line total, discount amount and its allocation, tax per order per tax class, total, change, refund amount, cash rounding). If a prescribed method is verified to apply it replaces the policy in one place ⚖ VR-4. The client never rounds authoritative values.
- Product quantities are positive integers; ingredient quantities are decimal strings with up to 3 dp; unit costs up to 4 dp (BUSINESS-RULES §0, §4a).
- No Philippine tax rate is a production value. Tax is disabled with an empty rate at production init; rate/mode come from Settings → Tax (Q-TAX-1, ⚖ VR-4). The current POS mock `MOCK_VAT_RATE = 0.12` is temporary UI data and is not an API value (§6.3).

### 1.3 Errors

Envelope: `{ "error": { "code": "INSUFFICIENT_STOCK", "message": "…", "details": { … } } }`. `code` is stable and machine-readable; `message` is for display; `details` carries field errors or offending items (e.g. `{ "items": [{ "subject_type", "subject_id", "requested", "available" }] }`). Credentials, hashes, activation codes, device credentials and customer ID numbers never appear in errors.

| Code | HTTP | Raised when (typical endpoints) |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Body/query shape or range invalid (incl. non-text value in a text field, non-boolean in a boolean field — §0.1); missing required `Idempotency-Key`; settings cross-rule failed (§4.10); **as built:** wrong current credential on change-password/change-pin. |
| `UNAUTHENTICATED` | 401 | No/invalid access token, session ended, user deactivated, or sign-in failed (one generic error for wrong user, wrong credential, or credential of the non-selected method). |
| `SESSION_EXPIRED` | 401 | Session idle longer than `security.idle_timeout_minutes`; session ended with `end_reason` `idle_timeout` (§1.8). |
| `PERMISSION_DENIED` | 403 | Caller lacks the ✱ permission, or a non-configurable protection applies (PERMISSIONS §4). |
| `FEATURE_DISABLED` | 403 | ⚑ feature off (e.g. Refunds OFF → refund endpoints, Q-REF-4). |
| `TERMINAL_NOT_ACTIVATED` | 403 | `X-Device-Credential` missing/invalid/revoked or terminal not `active`. |
| `NOT_FOUND` | 404 | Resource does not exist (or is not visible to the caller). |
| `CONFLICT` | 409 | Generic conflict: unique name/code taken; delete of a referenced configuration object (Q-DEL-1 → deactivate instead); same `Idempotency-Key` still in progress. |
| `VERSION_CONFLICT` | 409 | `expected_version` (orders) or `version` (settings) is stale (§1.6). |
| `INVALID_TRANSITION` | 409 | Order/payment/terminal state does not allow the action (e.g. completed → any, void of a completed payment, refund of a non-completed order). |
| `INSUFFICIENT_STOCK` | 409 | Reservation exceeds `available`, or a movement would make `on_hand` negative (Q-INV-3 ★); `details.items` lists the offending stock subjects. |
| `STOCK_RESERVED` | 409 | Manual adjustment would reduce `on_hand` below `reserved` (Q-INV-3). |
| `ORDER_NOT_SETTLED` | 409 | Completion requested while `payment_status` ≠ `paid` (Q-PAY-1). |
| `LIMIT_REACHED` | 409 | Staffing limit (max admins / staff / active terminals) on create, reactivation or terminal activation. |
| `SETUP_REQUIRED` | 409 | Any non-setup endpoint (except `/health`) before setup is completed. |
| `SETUP_ALREADY_COMPLETED` | 409 | Any `/setup/*` write endpoint (not `GET /setup/status`) after setup is completed (permanent). |
| `RESTORE_WINDOW_EXPIRED` | 409 | Restore requested after `archiving.restore_window`. |
| `DISCOUNT_ALREADY_APPLIED` | 409 | A second discount on one order (Q-DSC-1 ★). |
| `RESYNC_REQUIRED` | 409 | Event resume/replay requested from a sequence outside the replay window (§2); the client must refetch state. |
| `EMPTY_CART` | 400 | `POST /orders` / `POST /orders/quote` with no lines. |
| `ACTIVATION_CODE_INVALID` | 400 | Terminal activation code unknown, expired, already used, or invalidated by reset. |
| `DISCOUNT_MIN_ORDER` | 422 | Subtotal below the discount's `min_order`. |
| `IDENTIFICATION_REQUIRED` | 422 | Discount has `requires_identification` and a required `identification_fields` value is missing (Q-DSC-3; ⚖ VR-2, VR-7). |
| `OVERPAYMENT` | 422 | Payment `amount` > remaining balance (total − completed − pending). |
| `INSUFFICIENT_TENDER` | 422 | Cash `tendered` < `amount`. |
| `REFERENCE_REQUIRED` | 422 | Non-cash method with `require_reference` on and no valid reference. |
| `METHOD_NOT_ENABLED` | 422 | Payment method disabled in Settings → Payments. |
| `REFUND_EXCEEDS_REFUNDABLE` | 422 | Σ refunds would exceed Σ completed payment `amount` (Q-REF-1). |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Same `Idempotency-Key` with a different request payload (§1.5). |
| `RETENTION_BELOW_MINIMUM` | 422 | `archiving.retention_period` < `compliance.retention_minimum` (Q-ARC-3; ⚖ VR-6). |
| `AUTH_METHOD_NOT_ALLOWED` | 422 | `pin` chosen for an Admin account (create, edit, role change, credential change), or `POST /auth/change-pin` by a password account. |
| `CREDENTIAL_CHANGE_REQUIRED` | 403 | **As built:** the temporary credential must be changed before other calls. |
| `SETUP_TOKEN_INVALID` | 403 | **As built:** `X-Setup-Token` missing or wrong on setup endpoints. |
| `DECISION_PENDING` | 409 | **As built:** the action depends on an OPEN decision (e.g. username rename Q-AUTH-5, paid-order cancel Q-CAN-1); `details.question_id`. |
| `SETTINGS_REQUIRED` | 409 | **As built:** a needed settings section has not been saved yet. |
| `SETUP_TOKEN_NOT_CONFIGURED` | 503 | **As built:** the server has no valid `SETUP_TOKEN`; setup is locked. |
| `DATABASE_NOT_CONFIGURED` | 503 | **As built:** `DATABASE_URL` missing. |
| `ACCOUNT_LOCKED` | 423 | Too many failed sign-in attempts; `locked_until` in the future (values ⚠ OPEN Q-AUTH-7 ★). |

### 1.4 Lists

`?page=&page_size=&sort=&q=` plus resource filters → `{ items, total, page, page_size }`. Lists never return full customer ID data (masked, Q-DSC-3 ⚖ VR-7).

### 1.5 Idempotency

- Header `Idempotency-Key: <client-generated UUID>`. **Required** on: `POST /orders`, `POST /orders/{id}/payments`, `POST /orders/{id}/refunds`, `POST /orders/{id}/cancel`, `POST /orders/{id}/status` with target `completed`, and inventory/ingredient `restock` and `adjust`. Missing on a required endpoint → 422 `VALIDATION_ERROR`. Optional (honoured if sent) on other mutations.
- The server stores the key in `idempotency_records` (`key`, `scope` = business + endpoint (including the target resource id, e.g. the order id) + user/terminal — never the session, so a retry after re-login (e.g. after `SESSION_EXPIRED`) still matches the stored record, `request_hash`, `response`, `created_at`) **in the same transaction** as the effect. The **first response is stored and replayed** for every retry with the same key and same payload — no duplicate order, payment, refund, movement or document is ever created by a retry (SR-3).
- Same key + different payload (different `request_hash`) → 422 `IDEMPOTENCY_KEY_REUSED`. Same key while the first request is still running → 409 `CONFLICT` (retry later).
- Idempotency is checked **after** authentication, ⚑ and ✱, so a replay never bypasses a permission or feature check (PERMISSIONS §5.2).
- Offline transactions use `client_txn_id` instead (unique in `offline_submissions`, SR-4, §3 Sync).
- How long idempotency records are kept is an implementation setting; it must exceed the client retry window.

### 1.6 Optimistic concurrency

- Orders carry `version` (int). `POST /orders/{id}/status` and `POST /orders/{id}/cancel` require `expected_version`; stale → 409 `VERSION_CONFLICT`; a transition not allowed by the state machine → 409 `INVALID_TRANSITION` (SR-3). Every successful order mutation (status, cancel, payment settlement, refund status) increments `version`.
- Settings `PUT /settings/{section}` sends `version`; stale → 409 `VERSION_CONFLICT` (no silent overwrite).
- On any 409 the client reverts its optimistic state, refetches and shows the reason (SR-2).

### 1.7 Setup guard (Q-AUTH-1 ★)

`system_state.setup_status` ∈ {`not_started`, `in_progress`, `completed`}. Before `completed`, only `/setup/*` and `/health` respond; everything else → 409 `SETUP_REQUIRED` (the client shows the setup wizard). After completion, every `/setup/*` write endpoint permanently returns 409 `SETUP_ALREADY_COMPLETED` — except read-only `GET /setup/status`, which always answers (reports `completed`) so a device can choose between the wizard and Login (C-23) (the client shows Login). No default or shipped password exists.

### 1.8 Sessions & idle timeout (Q-AUTH-4 ★)

- `security.idle_timeout_minutes` (business-wide, value from the allowed list; approved candidates 5, 10, 15, 30, 60; default ⚠ OPEN Q-SET-4 ★).
- The server updates `sessions.last_activity_at` on **user-initiated requests only** — not on real-time heartbeats, event-stream traffic or token refresh. Background and poll requests (Auto Refresh, polling fallback, `GET /events`, `POST /sync/status`, `/auth/refresh`, the event stream) never update it: the client marks list polls as background (e.g. an `X-Request-Origin: background` header) and the endpoints listed are always treated as background.
- On each request, a session idle longer than the timeout is ended (`end_reason` `idle_timeout`) → 401 `SESSION_EXPIRED`; the client returns to Login. The client-side timer is UX only; offline enforcement is local (risk AR-3).
- Other session endings: `logout`, `lock`, `forced`, `user_deactivated`, `terminal_revoked` → subsequent calls 401 `UNAUTHENTICATED` (a `session.ended` event is sent when a stream is open). Concurrent sessions per user ⚠ OPEN Q-AUTH-6.

### 1.9 Feature gates (⚑)

Settings → Features are business-wide. A granted ✱ on a disabled ⚑ module still yields 403 `FEATURE_DISABLED` for its write endpoints; existing data is preserved. Gates: ⚑Inventory, ⚑Ingredient Tracking (tracking behaviour when disabled ⚠ OPEN Q-FEAT-1), ⚑Discounts, ⚑Refunds (Q-REF-4: OFF → refund endpoints 403, UI hides refund actions, historical refunds stay visible), ⚑Expenses, ⚑Analytics. Features → Live Updates is **not** a 403 gate: it controls presentation only (precedence vs Preferences → Live Updates & Auto Refresh ⚠ OPEN Q-SET-2) and never blocks the stream or replay required by SR-1. Admin read access to disabled-feature data ⚠ OPEN Q-FEAT-2. Offline mode is a setting (`offline.enabled`), not a feature gate.

---

## 2. Real-time events (SR-1)

| Aspect | Rule |
|---|---|
| Transport | **⚠ OPEN (Q-ARCH-3 ★)**: either SSE `GET /events/stream` or WebSocket `/ws`. Both carry the same envelope and channels. Authentication (access token + device credential) follows the same session; how the token is presented on the chosen transport is fixed with Q-ARCH-3. |
| Envelope | `event_id`, `sequence` (per-business, monotonically increasing), `type`, `entity_type`, `entity_id`, `entity_version`, `occurred_at`, `actor_id`, `terminal_id`, `payload`. |
| Resume | The client sends its `last_sequence` when (re)connecting; the server delivers everything after it. |
| Replay | `GET /events?after_sequence=` returns missed events (permission-filtered) for polling / catch-up. Beyond the replay window → 409 `RESYNC_REQUIRED`; the client refetches the affected lists (orders board, stock, settings) and resumes from the current sequence. |
| Source | Events are written to the `domain_events` outbox **in the same transaction** as the change and published **after commit** — no event for a rolled-back change. |
| Filtering | Per receiving session by permission and ⚑ (PERMISSIONS §5.3). Payloads are minimal and never contain credentials, activation codes, device credentials, customer ID numbers, or cost data for sessions without the permission (risk AR-16). `settings.changed` carries section + version only. |
| Session | Heartbeats keep the connection alive but do not refresh `last_activity_at`; the stream closes when the session ends. |
| Offline | No stream while offline; on reconnect the client syncs its queue (§3 Sync) then resumes/replays events. |

Event types (definitions and triggering actions: SYSTEM-LOGIC §10): `order.created` · `order.status_changed` · `order.cancelled` · `order.completed` · `order.archived` · `order.restored` · `payment.recorded` · `payment.confirmed` · `payment.voided` · `order.payment_status_changed` · `refund.recorded` · `stock.changed` · `stock.low` · `stock.out` · `alert.order_overdue` · `settings.changed` · `terminal.status_changed` · `session.started` · `session.ended` · `staff.status_changed` · `sync.review_required`.
Channels: orders · payments · inventory · alerts · settings · terminals · sessions · staff · sync.

---

## 3. Router map

Existing stub files in `backend/app/routers/` (all empty except `health.py` ✅) plus new router files. "Idem" = `Idempotency-Key` required (§1.5).

| Router file | Endpoints |
|---|---|
| `health.py` ✅ | `GET /health` — no auth, available before setup. (**As built:** §0 lists every implemented endpoint.) |
| *(new)* `setup.py` | **As built:** `GET /setup/status`, `POST /setup/complete`, `POST /setup/first-terminal` with `X-Setup-Token` (§0.1). Planned: Only while setup incomplete (§1.7); no auth; protection on a network-reachable fresh install ⚠ OPEN Q-AUTH-8 ★ (risk AR-8). `GET /setup/status` → `setup_status` (always readable, also after completion) · `POST /setup/business` (business name, type, address, contact, currency, timezone — validated and staged; `setup_status` → `in_progress`) · `POST /setup/admin` (full name, username, password chosen by the owner; Admin → `password` method only; credential policy ⚠ Q-AUTH-7) · `POST /setup/complete` (§4.8). How the setup device becomes the first terminal ⚠ OPEN Q-TRM-8 ★. |
| `auth.py` | `POST /auth/login` (username + password **or** PIN per the account's `auth_method`; `X-Device-Credential` required) → access token (+ refresh cookie), user, role, effective permissions, features, `must_change_credential`, terminal, settings bundle; failed attempts counted, lockout 423 `ACCOUNT_LOCKED`; rate-limited (AR-9) · `POST /auth/refresh` (**not implemented**, §0) · `POST /auth/logout` · `POST /auth/lock` (session locked on this terminal; Login shows the user pre-filled) · `POST /auth/unlock` (same user re-enters the credential of their method; **not implemented** — re-sign-in uses `POST /auth/login`, §0) · `GET /auth/me` · `PATCH /auth/me` (full_name) ✱ own (`settings.account`) · `POST /auth/change-password` (current, new) ✱ own, password accounts; wrong current → **422 `VALIDATION_ERROR`** (as built) · `POST /auth/change-pin` (current, new) ✱ own, PIN accounts only (Admin/password account → 422 `AUTH_METHOD_NOT_ALLOWED`). Admin Mode / Lock Admin ⚠ OPEN Q-AUTH-3. |
| *(new)* `terminals.py` | ✱`terminals.manage` (Admin only): `GET /terminals` · `POST /terminals` (code, name) → terminal `pending_activation` + **one-time, short-lived activation code shown once** (stored hashed) · `PATCH /terminals/{id}` (name) · `POST /terminals/{id}/deactivate` (revokes device credential, ends its sessions `terminal_revoked`) · `POST /terminals/{id}/reset-activation` (revokes credential, invalidates old code, issues a new one) · `POST /terminals/{id}/reactivate` (`inactive` only; Maximum Active Terminals → 409 `LIMIT_REACHED`; because deactivation revoked the credential, issues a new one-time activation code and returns the terminal to `pending_activation`). Device: `POST /terminals/activate` (activation code → device credential, §4.7) — no user auth; 400 `ACTIVATION_CODE_INVALID`; 409 `LIMIT_REACHED` (Maximum Active Terminals). Staff restricted to assigned terminals ⚠ OPEN Q-TRM-6. Offline ✖. |
| `staff.py` | `GET /staff` ✱staff.view · `POST /staff` ✱staff.add (limits → 409 `LIMIT_REACHED`; `auth_method`; initial credential; Admin + `pin` → 422 `AUTH_METHOD_NOT_ALLOWED`) · `GET /staff/{id}` ✱staff.view · `PATCH /staff/{id}` ✱staff.edit (role change → ✱staff.managePermissions; `auth_method` change audited; username rename ⚠ OPEN Q-AUTH-5) · `POST /staff/{id}/deactivate` / `activate` ✱staff.deactivate (last active Admin protected; deactivation ends sessions `user_deactivated`; reactivation checks limits) · `POST /staff/{id}/reset-credential` ✱staff.resetPasswords (replaces `reset-password`; temporary password **or** PIN per the account's method, shown once; sets `must_change_credential`) · `GET /staff/{id}/activity` ✱staff.view. No self-escalation (PERMISSIONS §4). |
| `products.py` | `GET /categories` ✱products.view · `POST /categories` (`name`, **`code_prefix`** required: 2–5 letters/digits starting with a letter, uppercased; duplicate → 409), `PATCH /categories/{id}` (`code_prefix` cannot change → 422) ✱products.edit · `DELETE /categories/{id}` ✱products.delete **and Admin role** (a Cashier granted products.delete still gets 403 `PERMISSION_DENIED`; permanent, Q-DEL-1): allowed only if the category never held a product — soft-deleted ones included — and its `product:<category_id>` code counter never issued a code; else 409 `CONFLICT` ("This category has N products and cannot be deleted. Move or delete them first." / "Product codes were already issued from this category."), nothing is changed and products are never reassigned; deletes only the category (and its unused counter row), audited as `category.deleted` with name and prefix · `GET /products` ✱products.view · `POST /products` ✱products.create (**no `code`: the server generates `PREFIX-NNN`** from the category; an explicit `code` is still accepted for backward compatibility, uppercased, duplicate → 409; `track_units`, `track_ingredients`, `tax_class`; optional initial unit stock → `initial` movement) · `GET/PATCH /products/{id}` ✱products.edit (`code` is immutable → 422 if changed; changing `category_id` keeps the code; stock is never changed via product edit) · `POST /products/{id}/duplicate` ✱products.create · `POST /products/{id}/activate|deactivate` ✱products.edit · `DELETE /products/{id}` ✱products.delete (only if never referenced — never sold, reserved or in a movement; else 409 `CONFLICT`; Q-DEL-1) · `POST /products/{id}/image` ✱products.edit (raw body `image/png|jpeg|webp`, ≤ 3 MB; magic bytes must match the declared type and the image must fully decode → 415 `UNSUPPORTED_MEDIA_TYPE` / 422 `VALIDATION_ERROR` / 413 `PAYLOAD_TOO_LARGE`; stored in Supabase Storage, returns the product with its public `image_url`; the previous image is deleted; 503 `STORAGE_NOT_CONFIGURED`, 502 `STORAGE_UNAVAILABLE` leave the product unchanged) · `DELETE /products/{id}/image` ✱products.edit (clears `image_url`, removes the object; idempotent) · `POST /products` ignores a client-supplied `image_url` · `PUT /products/{id}/choice-groups` ✱products.edit. |
| `choices.py` | `GET /choice-groups` ✱choices.view · `POST /choice-groups`, `PATCH /choice-groups/{id}`, options create/edit/activate/deactivate ✱choices.manage · delete of a group/option only if never referenced (Q-DEL-1). Option ingredient modifiers ⚠ OPEN Q-ING-2. |
| `inventory.py` | ⚑Inventory · Unit stock (`stock_levels`, `subject_type` product): `GET /inventory` (`on_hand`, `reserved`, `available`, status in/low/out, threshold, last restock) ✱inventory.view · `GET /inventory/{product_id}/movements` ✱inventory.view · `POST /inventory/{product_id}/restock` ✱inventory.restock, Idem · `POST /inventory/{product_id}/adjust` ✱inventory.adjust, Idem (reason required; below `reserved` → 409 `STOCK_RESERVED`; never clamped) · `PATCH /inventory/{product_id}` (low-stock threshold) ✱inventory.adjust. Low-stock default for new items = Staffing threshold (Q-INV-4, decided; client pre-fills, per-item value authoritative). Offline ✖. |
| `ingredients.py` | ⚑Ingredient Tracking · `GET /ingredients` (with `on_hand`, `reserved`, `available`) ✱ingredients.view · `POST /ingredients`, `PATCH /ingredients/{id}`, activate/deactivate ✱ingredients.recipes (delete only if never referenced, Q-DEL-1) · `GET /ingredients/{id}/movements` ✱ingredients.view · `POST /ingredients/{id}/restock` / `adjust` ✱ingredients.adjust, Idem (same rules as unit stock) · `GET/PUT /products/{id}/recipe` ✱ingredients.recipes (unit conversion ⚠ OPEN Q-ING-4; costing ⚠ OPEN Q-ING-3). |
| *(new)* `pos.py` | **As built: `GET /pos/menu`** (§0.1; discounts omitted while ⚑Discounts is off). Planned: `GET /pos/catalog` ✱pos.view — online POS bundle: active categories, available products with **availability = min(unit availability, ingredient-limited availability)** (Q-INV-1 ★), linked choice groups/options, active discounts (incl. `requires_identification`, `identification_fields`), tax & payment settings (incl. `cash_rounding`), default order type, `catalog_version`. |
| `orders.py` | `POST /orders/quote` ✱pos.view — server-side totals preview (no reservation) · **`POST /orders`** ✱pos.createOrders (+ ✱pos.applyDiscounts and ⚑Discounts if a discount), Idem — create + reserve stock atomically (§4.1; replaces the removed `POST /orders/checkout`) · `GET /orders` (`status`, `payment_status`, `refund_status`, `origin`, `order_type`, date, `q`) ✱orders.view · `GET /orders/{id}` ✱orders.view (items, discount snapshot with ID fields masked, payments, `remaining_balance`, refunds, documents, `version`) · `POST /orders/{id}/status` (`target`, `expected_version`) ✱orders.changeStatus; target `completed` → ✱orders.complete + settlement + Idem (§4.3) · `POST /orders/{id}/cancel` (`reason`, `expected_version`) ✱pos.cancelOrders, Idem (§4.4) · `PATCH /orders/{id}` ✱pos.editOrders — **⚠ OPEN (Q-ORD-2): not implemented until decided**; *Interim safe behaviour — not a decision:* items are read-only once the order exists. |
| `payments.py` | `POST /orders/{id}/payments` ✱pos.processPayments, Idem — split payments (§4.2; Q-PAY-1 ★, Q-PAY-2) · `POST /payments/{id}/confirm` (**as built:** `POST /orders/{id}/payments/{payment_id}/confirm`) ✱pos.processPayments (meaning of confirmation ⚠ OPEN Q-PAY-3 ★) · `POST /payments/{id}/void` (**as built:** `POST /orders/{id}/payments/{payment_id}/void`) ✱pos.processPayments (`pending` only; else 409 `INVALID_TRANSITION`) · `POST /orders/{id}/refunds` ✱pos.processRefunds ⚑Refunds, Idem — full/partial (§4.5; Q-REF-1 ★, Q-REF-4) · `GET /orders/{id}/refunds` ✱orders.view (historical refunds visible even when ⚑Refunds is OFF). Other payment methods ⚠ OPEN Q-PAY-4. |
| `discounts.py` | `GET /discounts` ✱settings.view · `POST /discounts`, `PATCH /discounts/{id}` ✱settings.discounts ⚑Discounts (name, type percentage/fixed, value, eligibility incl. `senior`/`pwd`, `min_order`, `max_discount`, `requires_identification`, `identification_fields` ⊆ {customer name, ID type, ID number}; **no `tax_handling`** — C-12, Q-TAX-2) · `POST /discounts/{id}/activate|deactivate` ✱settings.discounts · `DELETE /discounts/{id}` ✱settings.discounts (never applied only, Q-DEL-1). Senior Citizen/PWD are ordinary definitions (Q-DSC-2 ★); statutory treatment is a separate compliance rule (⚖ VR-1). Discount approval ⚠ OPEN Q-DSC-4. |
| `receipts.py` (serves `/documents`; UI label "Receipts") | `GET /documents` (`date`, `status`, `document_type`, `q`) ✱receipts.view · `GET /documents/{id}` ✱receipts.view (immutable snapshot; identification display per compliance settings ⚖ VR-2, VR-7) · `POST /documents/{id}/reprint` ✱receipts.reprint — same number, `print_count` + 1, `document_prints` row + audit, reprint marker text from compliance settings (⚖ VR-3); archived orders reprint as an archived copy. The old `/receipts` paths are replaced by `/documents`. Pre-payment order slip ⚠ OPEN Q-RCP-3 (no endpoint; the sales document is issued only at full settlement). Printing integration ⚠ OPEN Q-ARCH-4; which logo prints ⚠ OPEN Q-RCP-4. |
| `history.py` | `GET /history` (range, cashier, terminal, method, status, `refund_status`, type, `q`; includes summary) ✱history.view · `GET /history/{order_id}` ✱history.view · `GET /history/export.csv` ✱history.export (gap key, Admin only). |
| `archived_orders.py` | ✱archive.manage (Admin only): `GET /archive` (`view=archived` default \| `view=cancelled_review` — cancelled orders not yet archived; date range, status, cashier, `q`) · `POST /archive` (`order_ids` non-empty — empty → 422 as built, `reason` required; completed or cancelled orders; manual archive — Q-ARC-1 ★, Q-ARC-4) · `POST /archive/{order_id}/restore` (completed orders only, within `archiving.restore_window`, else 409 `RESTORE_WINDOW_EXPIRED`; returns to History, never to the active board; excluded from automatic re-archiving — Q-ARC-2 ★). Automatic archiving is a scheduled job, **no endpoint** (§4.11). Offline ✖. |
| `expenses.py` | ⚑Expenses · `GET /expenses` ✱expenses.view · `POST /expenses` ✱expenses.record (`recorded_by` = caller) · `PATCH /expenses/{id}` ✱expenses.edit (audited) · `POST /expenses/{id}/void` or `DELETE /expenses/{id}` ✱expenses.delete — **⚠ OPEN (Q-EXP-1)**; the approved history-preservation principle points to void-with-reason. Custom categories ⚠ OPEN Q-EXP-2. Offline ✖. |
| `analytics.py` | **As built: only `GET /analytics/sales?start&end` (raw feed, §0.1).** Planned: ⚑Analytics · `GET /analytics/overview` ✱analytics.view · `GET /analytics/sales?range&compare` · `/orders` · `/products` · `/payments` · `/expenses` · `/inventory` ✱analytics.view · `/insights` ✱analytics.insights. Read-only aggregations of persisted data (BUSINESS-RULES §16). Offline ✖. |
| `settings.py` | `GET /settings` — bundle of the sections the caller may see (✱settings.view; **as built:** operational values every session needs come from `GET /settings/operational` and `GET /pos/menu`, §0.1) · `GET/PUT /settings/{section}` (§4.10) with ✱: `business` settings.business · `branding` settings.branding (+ `POST /settings/branding/logo`) · `terminology` settings.terminology (gap key) · `features` settings.features · `tax` settings.tax · `payments` settings.payments (+ `cash_rounding`) · `receipts` settings.receipts (display only) · `staffing` settings.staffing · `preferences` settings.preferences (business-wide, Q-SET-1 ★) · `security` settings.security · `archiving` settings.archiving · `offline` settings.offline · `compliance` settings.compliance (gap keys, Admin only) · `GET/PUT /settings/permissions` ✱staff.managePermissions. Account is the caller's own record (`/auth/me`), not a settings document. Offline ✖. |
| *(new)* `sync.py` | `GET /sync/snapshot` ✱pos.view — offline bundle for `catalog_version` (catalog, prices, discounts, tax/payment/offline settings, local stock snapshot, effective permissions, features; retained server-side as `pos_snapshots`) · `POST /sync/transactions` (queued offline transactions, each with `client_txn_id`; per-transaction permission check at sync — §4.6) · `POST /sync/status` (device queue heartbeat: queued count, oldest `captured_at`, failed attempts; feeds `offline.sync_review_threshold` warnings) · `GET /sync/reviews`, `GET /sync/reviews/{id}`, `POST /sync/reviews/{id}/resolve` ✱sync.review (Admin only; resolution audited; original submission never modified). |
| *(new)* `events.py` | Real-time stream `GET /events/stream` (SSE) **or** `/ws` (WebSocket) — ⚠ OPEN Q-ARCH-3 ★ · `GET /events?after_sequence=` replay (§2). Live Updates is a presentation toggle only (precedence ⚠ OPEN Q-SET-2); it never blocks the stream or replay required by SR-1; channel content filtered per PERMISSIONS §5.3. |
| *(new)* `audit.py` | `GET /audit?entity&actor&action&range` (**as built:** `entity_type`, `action`, `limit`) ✱audit.view (Admin only). Read-only; audit records are immutable (SR-7). |

**Removed / renamed vs Phase 3A:** `POST /orders/checkout` (→ `POST /orders` + `POST /orders/{id}/payments`) · `POST /staff/{id}/reset-password` (→ `reset-credential`) · `/receipts…` paths (→ `/documents…`, same router file) · `terminal` field in the login body (→ `X-Device-Credential`).

---

## 4. Service responsibilities behind key endpoints

Every use case runs in **one DB transaction** (BUSINESS-RULES §0); audit rows and outbox events are written inside it and events are published after commit. Locks, versions and the deterministic lock order are specified in SYSTEM-LOGIC §11.

### 4.1 `POST /orders` → `order_service.create_order()` (Q-ORD-1 ★, Q-INV-2 ★)

1. Pipeline + idempotency (§1.5).
2. Validate the cart (BUSINESS-RULES §2): non-empty (400 `EMPTY_CART`); products `active` + `available`; options active and linked; choice min/max/required; identical lines merged; order type enabled. Table/delivery reference required? ⚠ OPEN Q-ORD-4 (treated as optional); customer name/record ⚠ OPEN Q-ORD-5 ⚖ VR-7.
3. Discount (BUSINESS-RULES §5): at most one (409 `DISCOUNT_ALREADY_APPLIED`); ⚑Discounts + ✱pos.applyDiscounts; definition active; `min_order` (422 `DISCOUNT_MIN_ORDER`); identification fields when `requires_identification` (422 `IDENTIFICATION_REQUIRED`).
4. `PriceCalculator` (BUSINESS-RULES §5–§6, Q-TAX-2): line totals → subtotal → the one discount on listed prices → pro-rata allocation (largest remainder) → tax once per order per `tax_class` on the discounted taxable amount → total; Money rounding (Q-TAX-3). A statutory policy is applied only if `compliance.statutory_rules` enables one (disabled by default; SYSTEM-LOGIC §13; ⚖ VR-1, risk AR-17).
5. Consumption plan (Q-INV-1 ★): units for `track_units` products, recipe lines × quantity for `track_ingredients` products (both when both); disabled-feature behaviour ⚠ OPEN Q-FEAT-1.
6. Lock the affected `stock_levels` rows in deterministic order; every subject must have `available ≥ requested`, else 409 `INSUFFICIENT_STOCK` with offending items (all-or-nothing, Q-INV-3 ★); write `reservation` movements (`reserved` + q).
7. Allocate the order number from the business sequence (gaps from rollbacks acceptable); insert the order (`status` `pending`, `payment_status` `unpaid`, `refund_status` `none`, `origin` `online`, `version` 1, frozen totals), items, choices, discount snapshot (+ ID fields when required).
8. Audit (discount application incl. the ID-capture event, never the ID value); outbox `order.created`, `stock.changed` (+ `stock.low` / `stock.out` on threshold crossing).
9. Commit; store the idempotency response. No payment and no sales document are created here; "pay now" at creation ⚠ OPEN Q-ORD-6 — *Interim safe behaviour — not a decision:* the POS calls `POST /orders` then `POST /orders/{id}/payments`.

### 4.2 `POST /orders/{id}/payments` → `payment_service.record_payment()` (Q-PAY-1 ★, Q-PAY-2)

1. Pipeline + idempotency.
2. **Lock the order row**; order must be `pending`/`preparing`/`ready` and not `paid` (else 409 `INVALID_TRANSITION`).
3. **Remaining balance** = `total` − Σ completed (`amount` + `rounding_adjustment`) − Σ `pending` amounts. `amount` > remaining → 422 `OVERPAYMENT` (for a rounded settling cash payment, step 4, the cap applies to `amount + rounding_adjustment`, which equals remaining exactly) (pending payments therefore cannot lead to overpayment; risk AR-15).
4. **Cash rounding** (`payments.cash_rounding = { enabled, increment, mode }`, mode nearest/down/up): only for a **cash** payment that **settles the full remaining balance** while enabled → `amount` = remaining rounded by the configured rule, `rounding_adjustment = remaining − amount` stored on the payment; the order `total` is never changed. Non-cash and partial cash payments use the exact amount. Increment/mode are configuration, not facts ⚖ VR-5.
5. **Validate method / reference / tender:** method enabled (422 `METHOD_NOT_ENABLED`); non-cash (`gcash`, `card`, `bank_transfer`) = exact amount, reference 4–40 chars trimmed when the method's `require_reference` is on (422 `REFERENCE_REQUIRED`); cash: `tendered` required when `require_cash_received` is on, `tendered` ≥ the final `amount` from step 4 (422 `INSUFFICIENT_TENDER`), `change_given = tendered − amount` computed by the server.
6. **Insert** the payment (`status` `completed`, or `pending` when the method's `require_confirmation` is on — Q-PAY-3), with `terminal_id`, `user_id`, `idempotency_key`, `origin`.
7. **Settlement:** recompute `payment_status` (`unpaid` / `partially_paid` / `paid`); paid ⇔ Σ completed (`amount` + `rounding_adjustment`) = `total`; increment order `version`.
8. **If now `paid`:** allocate the sales document number from the configured `document_series` (row lock, gap-free within the series as a design goal) and issue the sales document (`document_type` `sales`, `status` `issued`, immutable snapshot; title/type from compliance settings, not assumed) — Q-RCP-1, Q-RCP-2 ★, ⚖ VR-3.
9. **Outbox:** `payment.recorded`, `order.payment_status_changed`. Drawer opening is a device action when `open_drawer` is on and a cash payment completes.
10. `POST /payments/{id}/confirm` runs steps 2, 7–9 for a pending payment (`payment.confirmed`); `POST /payments/{id}/void` voids a pending payment (`payment.voided`). Completed payments are never edited — reversal only through a refund.

### 4.3 `POST /orders/{id}/status` → `order_service.change_status()`

- Validate `target` against the state machine (BUSINESS-RULES §1: `pending` → `preparing` → `ready` → `completed`, allowed forward skips, same-shift undo) and `expected_version` (409 `INVALID_TRANSITION` / `VERSION_CONFLICT`). Per-order-type steps ⚠ OPEN Q-ORD-3.
- **Target `completed`** (✱orders.complete, Idem): **lock the order row** → re-check `version` and status → require `payment_status` `paid` (409 `ORDER_NOT_SETTLED`) → lock the reserved `stock_levels` rows in deterministic order → convert each reservation into a `sale` movement (`on_hand` − q **and** `reserved` − q) → set `completed_at`, `version` + 1. A second completion finds `completed` → 409 `INVALID_TRANSITION` (no double completion, SR-3).
- Outbox `order.status_changed` (+ `order.completed`, `stock.changed`, `stock.low`/`stock.out`).

### 4.4 `POST /orders/{id}/cancel` → `order_service.cancel()`

- ✱pos.cancelOrders (protected), Idem, `reason` required (≤ 200 chars), `expected_version`; lock the order row; allowed from `pending`/`preparing`/`ready` only.
- **Void pending payments** (`payment.voided`) and **release reservations** (`reservation_release` movements, `reserved` − q, deterministic lock order).
- Order with any **completed** payment ⚠ OPEN (Q-CAN-1 ★; interacts with the Refunds toggle, C-19, risk AR-14). *Interim safe behaviour — not a decision:* the server rejects the cancellation with 409 `CONFLICT` so no money is returned outside a refund record.
- Set `cancelled`, `cancelled_at`, `cancel_reason`, `version` + 1; audit; outbox `order.cancelled`, `stock.changed`. Cancelled orders are never auto-archived (§4.11). Offline: online orders ✖.

### 4.5 `POST /orders/{id}/refunds` → `refund_service.record_refund()` (Q-REF-1 ★, Q-REF-4)

1. ⚑Refunds (OFF → 403 `FEATURE_DISABLED`), ✱pos.processRefunds, Idem, `reason` required; extra Admin approval ⚠ OPEN Q-DSC-4 / Q-AUTH-3.
2. Lock the order row; order must be `completed` (else 409 `INVALID_TRANSITION`; paid-not-completed → Q-CAN-1).
3. **Server computes** the refund amount: full = refundable remainder; partial = per the request shape fixed by ⚠ OPEN **Q-REF-5 ★** (by line/quantity vs arbitrary amount). Σ refunds ≤ Σ completed payment `amount` (422 `REFUND_EXCEEDS_REFUNDABLE`).
4. Insert `refunds`, `refund_lines`, `refund_allocations` (allocation across split payments and refund method/time limit ⚠ OPEN Q-REF-2 ★ ⚖ VR-8). Restock (`sale_reversal`) only once ⚠ OPEN Q-REF-3 is decided.
5. Update order `refund_status` (`partially_refunded` / `refunded`) and the sales document `status`; the original order, payments and document snapshot are never edited. Refund document issuance/numbering per compliance settings ⚖ VR-3.
6. Audit; outbox `refund.recorded`. Offline ✖.

### 4.6 `POST /sync/transactions` → `sync_service` (SR-4, Q-TRM-2/3/4/5)

For each queued transaction (identified by device-generated `client_txn_id`):
1. **Persist the raw submission** in `offline_submissions` (`status` `received`, `captured_at` from device, `received_at` from server, `snapshot_version`, payload, attempts) — unique `client_txn_id`.
2. **Idempotency:** a duplicate `client_txn_id` returns the stored outcome.
3. **Validate:** terminal active and matches the device credential, user still active, required ✱ as they stand at sync, `snapshot_version` known (prices, discount and tax **recomputed from the server's stored `pos_snapshots`**, risk AR-4), discount rules, **cash only** (a non-cash payment is a conflict → step 6 `needs_review`, nothing applied, Q-TRM-4), offline limits ⚠ OPEN Q-TRM-7 ★.
4. **Validate inventory / payment / order state under locks** (same lock order as §4.1–4.3).
5. **Commit:** order with its canonical number (`origin` `offline`), payments, movements, sales document (offline numbering ⚠ OPEN Q-RCP-5 ★ ⚖ VR-3 — until resolved the device printed only a provisional slip and the sales document is issued here), audit, events → `status` `committed`, `order_id` returned; the client marks the transaction synced.
6. **Conflict** (e.g. insufficient server stock, changed permissions, unknown snapshot): `status` `needs_review`, `conflict_reasons` recorded, **nothing applied to stock or money**, outbox `sync.review_required`. Never silently merged, rewritten or dropped (SR-5, risk AR-1).
7. Not committed within `offline.sync_review_threshold` (time since capture and/or failed attempts) → flagged `needs_review` (server side; device shows a warning from `/sync/status`). Admin resolution via `/sync/reviews/{id}/resolve` is audited; stock corrections only via explicit Admin movements; `resolved` records the resolution.

Offline sign-in, discounts offline and reprint offline ⚠ OPEN Q-TRM-7 ★. When `offline.enabled` is off, devices do not enter offline mode, but already-queued transactions are still accepted for sync (nothing is lost).

### 4.7 `POST /terminals/activate` → `terminal_service.activate()` (Q-TRM-1 ★)

Setup must be completed → look up the activation code by hash, locking the terminal row and redeeming via a conditional update (`pending_activation`, code unused and not expired) so a code redeems at most once; unknown / expired / used / invalidated → 400 `ACTIVATION_CODE_INVALID` → check Staffing → Maximum Active Terminals under a per-business lock (e.g. on the staffing settings row; the same lock serialises staff create/reactivation limit checks) (409 `LIMIT_REACHED`) → generate the device credential (secret returned **once**, only its hash stored) → invalidate the code → terminal `active`, `activated_at`, `activated_by` → audit (terminal activation) → outbox `terminal.status_changed`. Risks: clearing browser storage de-activates the terminal; copying the credential clones it → reset activation, `last_seen` monitoring (AR-7).

### 4.8 `POST /setup/complete` → `setup_service.complete()` (Q-AUTH-1 ★)

Requires `setup_status` ≠ `completed` and valid staged business + Admin data → **one atomic transaction** that locks the `system_state` singleton row and re-checks `setup_status` = `in_progress` inside it (a concurrent second call gets 409 `SETUP_ALREADY_COMPLETED`). Staged setup data is held server-side on `system_state` (the Admin password is hashed when `/setup/admin` is received) and discarded if setup restarts. The transaction: create the `businesses` row and the first Admin (`auth_method` `password`, owner-chosen password hashed; credential policy ⚠ Q-AUTH-7 ★) → `system_state.setup_status` = `completed` → audit (setup completion). After commit the client goes to Login. Production init seeds only system data (SR-9); the wizard never creates products, stock, orders or demo data.

### 4.9 `POST /inventory/{product_id}/restock|adjust` and ingredient equivalents → `inventory_service`

Idem → lock the `stock_levels` row → restock quantity > 0; adjustment delta ≠ 0 with reason (Damaged/Lost/Other), note ≤ 200 chars → result `on_hand` < 0 → 409 `INSUFFICIENT_STOCK`; `on_hand` < `reserved` → 409 `STOCK_RESERVED` (rejected, never clamped; risk AR-11) → movement with `delta_on_hand`, `on_hand_after`, `reserved_after`, `reference_type` `manual` → audit → outbox `stock.changed` (+ `stock.low`/`stock.out`).

### 4.10 `PUT /settings/{section}` → `settings_service.save()` (Q-SET-1 ★)

Section schema validation → **cross-rules** (BUSINESS-RULES §17) → `version` check (409 `VERSION_CONFLICT`) → save + `settings_history` row → audit (every section incl. compliance) → outbox `settings.changed` (section + version). Cross-rules:

| Section | Server validation |
|---|---|
| `tax` | Enabled ⇒ name + rate 0 < r ≤ 100 and mode `included`/`excluded`; no default rate (⚖ VR-4). |
| `payments` | ≥ 1 method enabled; `cash_rounding.increment` > 0 and `mode` ∈ nearest/down/up when enabled (⚖ VR-5). |
| `receipts` | Display options only; compliance field locks override display toggles when set (C-3, ⚠ Q-SET-2). |
| `staffing` | Admins 1–10, staff 1–100, terminals 1–25, low stock 0–10 000, order waiting 1–240 min; lowering below current usage is allowed (blocks only new creations). |
| `security` | `idle_timeout_minutes` must be one of the allowed values (approved candidates 5, 10, 15, 30, 60); credential policy values ⚠ OPEN Q-AUTH-7 ★. |
| `archiving` | `auto_archive_after`, `restore_window`, `retention_period` > 0; `retention_period` ≥ `compliance.retention_minimum` (422 `RETENTION_BELOW_MINIMUM`, ⚖ VR-6). Defaults ⚠ OPEN Q-SET-4 ★. |
| `offline` | `enabled`, `sync_review_threshold`; limits ⚠ OPEN Q-TRM-7 ★. |
| `compliance` | Document types/titles, series (format template, scope business/terminal, start number, optional ranges, reset policy), must-print locks, reprint marker, `statutory_rules` (disabled by default, with verification metadata), `retention_minimum` (entered only after verification), identification display/printing policy — every value ⚖ (VR-1…VR-7). If a verified minimum exceeds the stored `retention_period`, the longer period applies. |
| `branding` / `terminology` | Semantic status colours never overridable / display strings only (API and DB names unchanged). |
| `permissions` | Non-configurable protections (PERMISSIONS §4): ≥ 1 active Admin, Admin keeps `staff.managePermissions` + `settings.view`, no self-escalation, gap keys not grantable to Cashier. |

Settings never rewrite historical orders or documents (snapshots).

### 4.11 Automatic archive job (no endpoint) — Q-ARC-4, Q-ARC-3

A server-side scheduled job (system actor) archives `completed` orders once `completed_at + archiving.auto_archive_after` has passed (business timezone): sets `archived_at`, audit (automatic archive), outbox `order.archived`. It **never** archives cancelled orders (manual Admin archive with reason via `POST /archive`) and skips orders that were restored (manual re-archive allowed; risk AR-13). Archiving never deletes. Retention: until a verified `compliance.retention_minimum` is configured **nothing is disposed**; end-of-retention handling ⚠ OPEN Q-ARC-5 ⚖ VR-6 (C-18, risk AR-12). Stale unpaid orders holding reservations are surfaced for review, never auto-cancelled (risk AR-10).

---

## 5. Open items that shape the API

| ID | API impact |
|---|---|
| Q-ARCH-3 ★ | SSE `GET /events/stream` vs WebSocket `/ws`; token presentation on the stream. |
| Q-ARCH-1 ★ · Q-ARCH-4 | DB hosting/access · printer integration behind reprint/print. (Q-ARCH-2 decided: Supabase Storage for product images.) |
| Q-ORD-2 · Q-ORD-6 | `PATCH /orders/{id}` · "pay now" in one POS action. |
| Q-PAY-3 ★ · Q-PAY-4 | Meaning of `POST /payments/{id}/confirm` · further payment methods. |
| Q-CAN-1 ★ · Q-REF-2 ★ · Q-REF-3 · Q-REF-5 ★ | Cancelling paid orders · refund method/time limit/allocation (⚖ VR-8) · restock on refund · partial-refund request shape. |
| Q-RCP-3 · Q-RCP-5 ★ | Pre-payment slip endpoint · offline document numbering (⚖ VR-3). |
| Q-AUTH-3 · Q-AUTH-5 · Q-AUTH-6 · Q-AUTH-7 ★ · Q-AUTH-8 ★ | Admin Mode · username rename · concurrent sessions · credential policy & lockout values · setup wizard protection. |
| Q-TRM-6 · Q-TRM-7 ★ · Q-TRM-8 ★ | Terminal restriction at login · offline scope/limits · first device / Admin access without a terminal. |
| Q-SET-2 · Q-SET-3 · Q-SET-4 ★ | Overlapping toggles · gap-key configurability · default values of new settings. |
| Q-FEAT-1 · Q-FEAT-2 · Q-DSC-4 · Q-EXP-1 · Q-EXP-2 · Q-INV-4 · Q-ING-2/3/4 · Q-ORD-3/4/5 · Q-ARC-5 · Q-BUS-1 | Endpoint details listed in §3. |

*Interim safe behaviour — not a decision (Q-TRM-8, from PERMISSIONS §1.2):* every sign-in, including Admin, requires an activated terminal. This alone cannot bootstrap the first terminal after setup, so Q-TRM-8 must be decided before `/setup/*`, `/auth/login` and `/terminals/*` are implemented.

---

## 6. Frontend integration points

### 6.1 Existing empty stubs (0 bytes today)

| Stub | Future responsibility |
|---|---|
| `services/api.ts` | Fetch wrapper: base `/api/v1`, bearer token, refresh cookie, `X-Device-Credential`, `Idempotency-Key` generation for §1.5 endpoints, error envelope → typed errors, `SESSION_EXPIRED` / `SETUP_REQUIRED` / `SETUP_ALREADY_COMPLETED` / `TERMINAL_NOT_ACTIVATED` routing. |
| `authService.ts` | Login (password or PIN), refresh, logout, lock/unlock, `/auth/me`, change password / PIN. |
| `productService.ts` | Categories, products, choices, recipes, `/pos/catalog`. |
| `inventoryService.ts` | Unit and ingredient stock, movements, restock/adjust. |
| `orderService.ts` | Quote, `POST /orders`, status, cancel, lists, history, archive, documents. |
| `paymentService.ts` | Split payments, confirm/void, refunds. |
| `expenseService.ts` · `analyticsService.ts` · `settingsService.ts` | Expenses · analytics · all settings sections incl. security/archiving/offline/compliance. |
| hooks `useAuth`, `useProducts`, `useInventory`, `useOrders`, `useSettings`, `useRealtime`, `useAdminAccess` | `useRealtime` = event stream + `last_sequence` resume + replay / `RESYNC_REQUIRED` handling; `useAdminAccess` only mirrors server permissions. |
| `components/auth/{LoginForm, ProtectedRoute, AdminGuard}` | Mirror server-returned permissions, features and `must_change_credential`; never grant access (PERMISSIONS §5.5). |
| `stores/{authStore, orderStore, settingsStore}` | Server-state caches; optimistic updates reverted on rejection (SR-2). |

Client modules for setup, terminal activation, the offline queue/sync and documents will be needed in addition; they are named in the integration phase.

### 6.2 UI changes happen later

The UI items that no longer match decided rules (single full payment at checkout / pay-first POS, Discounts "Tax Handling" control, `RESTORE_WINDOW_HOURS = 48`, fixed terminal list, no PIN / activation / setup wizard in Login, no Settings screens for security / archiving / offline / compliance, full-only refunds, no ID-capture fields, no offline indicator/queue, no cash rounding UI) are listed in SYSTEM-LOGIC §8.5 and are changed **in a later UI/integration phase**, not in Phase 3B (SR-10, risk AR-20).

### 6.3 Temporary UI data → endpoints (replace in the integration phase; do not remove now)

| Temporary data | Replaced by |
|---|---|
| `pages/POS/posMockData.ts` (incl. `MOCK_VAT_RATE = 0.12`) | `GET /pos/catalog` (tax from Settings → Tax; no hard-coded rate) |
| `pages/Orders/ordersMockData.ts` | `GET /orders` + real-time events |
| `pages/Receipts/receiptsMockData.ts` | `GET /documents` + `GET /settings/business` |
| `pages/History/historyMockData.ts` | `GET /history` |
| `pages/Admin/adminOverviewMockData.ts` | `GET /analytics/overview` |
| `components/admin/analytics/analyticsDemoData.ts` (opt-in) | Real analytics; toggle dev-only or removed |
| `components/admin/archived/archivedSampleData.ts` (dev-only) | `GET /archive` |
| In-memory stores (catalogStore, cartStore, all settings stores incl. `receiptSettingsStore`, accountStore) and page-local lists | Corresponding endpoints above; `RESTORE_WINDOW_HOURS` → `GET /settings/archiving`; fixed terminal list → `GET /terminals` |
