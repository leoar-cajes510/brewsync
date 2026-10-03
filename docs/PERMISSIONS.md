# BrewSync — Permission Model

> **Status: Phase 3B (2026-09-27)** — business rules and architecture finalized; planned design only, nothing here is implemented.
> **Frontend visibility is never the security mechanism.** The FastAPI backend authenticates the session, verifies the terminal, checks feature gates and the caller's role grants on **every** request, and enforces the non-configurable protections in §4 inside services. The UI only hides what the user cannot use.
> Decision status lives in [DECISIONS.md](DECISIONS.md). Related: BUSINESS-RULES §13 (roles & admin protection), §14 (terminals, authentication & sessions), §18 (first-run setup), §19 (offline), §20 (real-time), §21 (audit) · SYSTEM-LOGIC §4, §10, §12 · [API.md](API.md) (✱ permission / ⚑ feature gate per endpoint).
> Markers: ★ high priority · ⚖ requires legal/business verification · ⚠ OPEN not decided · ✱ permission · ⚑ feature gate.

---

## 1. Model

```
User ──► Role (Admin | Cashier) ──► RolePermission(permission_key, granted) ──► Permission
  │
  └─► Session ──► Terminal (activated, bound by device credential)
```

- Roles are fixed system roles today (`is_system = true`). Custom roles are out of scope.
- The permission **catalogue** (48 UI keys + 10 gap keys, §2) is defined in code (`core/permissions.py`) and mirrored in the DB (`permissions`, `role_permissions`) for grants; the UI (Settings → Permissions) edits only `granted` for the 48 configurable keys. The catalogue and default grants are seeded at production init (SR-9); nothing else is.
- **Protected** permissions (🔒) = management functions. Cashier never has them by default; granting one to Cashier requires Admin (✱`staff.managePermissions`), an explicit confirmation, and is audited.
- Effective permissions are returned at login and **re-checked server-side on every call** (cached per request; invalidated when grants change — a grant change takes effect on the caller's next request and re-evaluates real-time filters, §5.3).
- The client never supplies permissions, role, or terminal identity; any such value in a request is ignored (SR-2).

### 1.1 Authentication (Q-AUTH-2 ★ DECIDED)

| Role | Allowed sign-in method (`users.auth_method`) | Rules |
|---|---|---|
| **Admin** | `password` only (username + password) | Server rejects `pin` for an Admin account → 422 `AUTH_METHOD_NOT_ALLOWED` (on create, edit, role change to Admin, and credential change). |
| **Cashier** | `password` **or** `pin` (username + password, or username + PIN) | Method selected **per account by an Admin in Staff** (✱`staff.edit`, audited). |

- The backend accepts **only the account's selected method**; a credential of the other type is rejected with the same generic sign-in error as a wrong credential.
- Passwords and PINs are stored only as strong adaptive hashes (`password_hash` / `pin_hash`); failed attempts are counted (`failed_attempts`) and lead to lockout (`locked_until`, 423 `ACCOUNT_LOCKED`).
- **PIN sign-in is accepted only from an activated terminal** (device credential required; risk AR-9).
- Length / complexity / lockout values: **⚠ OPEN (Q-AUTH-7)** — one server-enforced credential policy (resolves C-1 in principle; values open). Stored in the `security` settings section.
- After a reset (§4 item 5) `must_change_credential` is set; the user must set a new credential of their method before continuing.
- Self-service changes: `POST /auth/change-password` (password accounts) / `POST /auth/change-pin` (PIN accounts only; an Admin calling it → 422 `AUTH_METHOD_NOT_ALLOWED`). Both operate only on the caller's own account and require the current credential.

### 1.2 Sessions & terminals (Q-TRM-1 ★, Q-AUTH-4 ★ DECIDED)

- **Terminal binding.** A session binds user + terminal. The terminal is derived from the **device credential** (`X-Device-Credential`) issued at activation — never from a client-supplied terminal code; a device cannot claim an arbitrary terminal. Request without a valid credential for an `active` terminal → 403 `TERMINAL_NOT_ACTIVATED`.
- **Activation.** Admin registers the terminal (✱`terminals.manage`) → server issues a one-time, short-lived activation code (shown once, stored hashed) → the device redeems it at `POST /terminals/activate` → device credential issued, terminal `active`. Invalid/expired/used code → 400 `ACTIVATION_CODE_INVALID`. Staffing → Maximum Active Terminals enforced at activation/reactivation → 409 `LIMIT_REACHED`.
- **Revocation.** Deactivating or resetting a terminal revokes its credential and ends its sessions (`end_reason` `terminal_revoked`); deactivating a user ends their sessions (`user_deactivated`).
- **Idle timeout (server-enforced).** `security.idle_timeout_minutes` (business-wide, allowed list; approved candidate values 5, 10, 15, 30, 60; default value ⚠ OPEN Q-SET-4). The server stores `sessions.last_activity_at`, updates it on **user-initiated requests only** (not real-time heartbeats or background refresh), and on each request ends a session idle longer than the timeout (`end_reason` `idle_timeout`, 401 `SESSION_EXPIRED`). The client timer is UX only; offline enforcement is local only (risk AR-3).
- Still open: Admin access from a device without an activated terminal / first device after setup **⚠ OPEN (Q-TRM-8)** — *Interim safe behaviour — not a decision:* every sign-in, including Admin, requires an activated terminal. Staff restricted to assigned terminals **⚠ OPEN (Q-TRM-6)** — *Interim safe behaviour — not a decision:* the staff "default terminal" is a sign-in preference, not a restriction. Concurrent sessions per user **⚠ OPEN (Q-AUTH-6)**. Admin Mode / Lock Admin **⚠ OPEN (Q-AUTH-3)**.

### 1.3 Feature flags (⚑)

Feature flags (Settings → Features, business-wide, ✱`settings.features`) gate modules **in addition** to permissions: a granted permission on a disabled feature still yields 403 `FEATURE_DISABLED`.

| Feature ⚑ | Gates | Note |
|---|---|---|
| **Refunds** (Q-REF-4 DECIDED) | `POST /orders/{id}/refunds` | ON → users with ✱`pos.processRefunds` may refund. OFF → refund endpoints return 403 `FEATURE_DISABLED`; UI hides refund actions. Historical refunds stay visible either way. Interaction with cancelling a paid order: ⚠ OPEN Q-CAN-1 (C-19, risk AR-14). |
| Inventory / Ingredient Tracking | unit / ingredient stock endpoints | Behaviour of tracking when disabled ⚠ OPEN Q-FEAT-1; Admin view of disabled-feature data ⚠ OPEN Q-FEAT-2. |
| Discounts, Expenses, Analytics | respective endpoints | — |
| Live Updates | — (presentation only; never blocks the event stream or replay, SR-1) | Precedence vs Preferences → Live Updates & Auto Refresh ⚠ OPEN Q-SET-2. |

Offline mode is a business setting (`offline.enabled`, ✱`settings.offline`), not a permission; see §4 items 16–17.

## 2. Action categories → permission keys

The 48 existing keys are unchanged.

| Category | Keys |
|---|---|
| **View** | `pos.view`, `orders.view`, `receipts.view`, `history.view`, `products.view`, `inventory.view`, `choices.view`, `ingredients.view`, `expenses.view`, `analytics.view`, `analytics.insights`, `staff.view`, `settings.view` |
| **Create** | `pos.createOrders`, `products.create`, `expenses.record`, `staff.add` |
| **Edit** | `pos.editOrders`, `products.edit`, `expenses.edit`, `staff.edit`, `choices.manage`, `ingredients.recipes` |
| **Delete** | `products.delete`, `expenses.delete`, `staff.deactivate` (deactivate, never delete) |
| **Process** | `pos.processPayments`, `pos.applyDiscounts`, `pos.cancelOrders`, `orders.changeStatus`, `orders.complete`, `receipts.reprint` |
| **Refund** | `pos.processRefunds` |
| **Restock / stock** | `inventory.restock`, `inventory.adjust`, `ingredients.adjust` |
| **Manage Staff** | `staff.add`, `staff.edit`, `staff.deactivate`, `staff.resetPasswords` |
| **Manage Settings** | `settings.business`, `settings.branding`, `settings.features`, `settings.tax`, `settings.payments`, `settings.discounts`, `settings.receipts`, `settings.staffing`, `settings.preferences`, `settings.account` |
| **Manage Permissions** | `staff.managePermissions` |

Key-name notes (names kept; meaning per Phase 3B):
- `receipts.view` / `receipts.reprint` cover **sales documents** (UI label "Receipt"; `/documents` endpoints). Reprint keeps the original number (Q-RCP-1).
- `staff.resetPasswords` covers resetting **either** credential type (password or PIN) via `POST /staff/{id}/reset-credential`.
- `settings.payments` includes `payments.cash_rounding` (Q-PAY-2, ⚖ VR-5). `settings.receipts` covers **display** settings only; compliance-controlled document settings are under `settings.compliance` (Q-RCP-2).
- `settings.account` covers the caller's own record only (§4 item 4).

### 2.1 Gap keys (backend catalogue; Admin-only until Q-SET-3)

These keys have no control in the Permissions UI yet. They exist in the backend catalogue, are granted to Admin, **cannot be granted to Cashier**, and are not configurable until **⚠ OPEN (Q-SET-3)** decides whether they become configurable keys.

| Key | Covers |
|---|---|
| `archive.manage` | Manual archive, cancelled-order review list, restore (`/archive`, `/archive/{order_id}/restore`) — Q-ARC-1/2/4 |
| `history.export` | History export (`/history/export.csv`) |
| `settings.terminology` | Settings → Terminology (display strings) |
| `terminals.manage` | Terminal registry: register, edit, deactivate, reset activation (issues activation codes) — Q-TRM-1 |
| `settings.security` | `security` section: idle timeout (Q-AUTH-4), credential policy (Q-AUTH-7) |
| `settings.archiving` | `archiving` section: `auto_archive_after`, `restore_window`, `retention_period` (Q-ARC-2/3/4, ⚖ VR-6) |
| `settings.offline` | `offline` section: `enabled`, `sync_review_threshold`, limits (Q-TRM-2/5/7) |
| `settings.compliance` | `compliance` section: document types/titles, series, must-print locks, reprint marker, `statutory_rules`, `retention_minimum`, identification display/printing (every value ⚖ VR-1…VR-7) |
| `sync.review` | Offline sync review & reconciliation (`/sync/reviews…`) — Q-TRM-5, SR-4 |
| `audit.view` | Audit log (`GET /audit`) |

## 3. Default grants (matches Settings → Permissions defaults)

✔ granted · ✖ not granted · 🔒 protected

| Area | Permission | Admin | Cashier |
|---|---|:-:|:-:|
| POS | View POS | ✔ | ✔ |
| | Create Orders | ✔ | ✔ |
| | Edit Orders | ✔ | ✔ |
| | Cancel Orders 🔒 | ✔ | ✖ |
| | Apply Discounts | ✔ | ✔ |
| | Process Payments | ✔ | ✔ |
| | Process Refunds 🔒 | ✔ | ✖ |
| Orders | View / Change Status / Complete | ✔ | ✔ |
| Receipts | View / Reprint | ✔ | ✔ |
| History | View Transaction History | ✔ | ✔ |
| Products | View | ✔ | ✔ |
| | Create / Edit / Delete 🔒 | ✔ | ✖ |
| Inventory | View | ✔ | ✔ |
| | Restock / Adjust 🔒 | ✔ | ✖ |
| Choices | View | ✔ | ✔ |
| | Manage 🔒 | ✔ | ✖ |
| Ingredients | View / Manage Recipes / Adjust 🔒 | ✔ | ✖ |
| Expenses | View / Record / Edit / Delete 🔒 | ✔ | ✖ |
| Analytics | View / Business Insights 🔒 | ✔ | ✖ |
| Staff | View / Add / Edit / Deactivate / Reset Passwords / Manage Permissions 🔒 | ✔ | ✖ |
| Settings | View + every Edit 🔒 | ✔ | ✖ |
| ***Gap keys (§2.1) — not configurable until Q-SET-3*** | | | |
| Archive | Archive / Restore orders (`archive.manage`) 🔒 | ✔ | ✖ |
| History | Export (`history.export`) 🔒 | ✔ | ✖ |
| Terminals | Manage terminals (`terminals.manage`) 🔒 | ✔ | ✖ |
| Settings | Terminology / Security / Archiving / Offline / Compliance (`settings.terminology`, `settings.security`, `settings.archiving`, `settings.offline`, `settings.compliance`) 🔒 | ✔ | ✖ |
| Sync | Review offline sync (`sync.review`) 🔒 | ✔ | ✖ |
| Audit | View audit log (`audit.view`) 🔒 | ✔ | ✖ |

Cashier default = **14 of 48** configurable keys. Admin default = 48 of 48 + all 10 gap keys (58 catalogue keys). Defaults for the 48 keys are configurable; the rules in §4 and the Admin-only gap keys are not.

## 4. Non-configurable protections (enforced in services, not just grants)

1. **Always ≥ 1 active Admin.** Reject deactivating, demoting, or removing access from the last active Admin.
2. The **Admin role** cannot lose `staff.managePermissions` or `settings.view` (prevents lock-out).
3. **No self-escalation:** a user cannot change their own role, their own role's grants, or their own `auth_method` (set by an Admin in Staff).
4. **Account scope:** `settings.account` / Account endpoints (`/auth/me`, `/auth/change-password`, `/auth/change-pin`) operate only on the caller's own user; Admin manages others via Staff.
5. **Passwords and PINs are never readable** by anyone (hashes only; never returned by any endpoint, log, audit record or event). A reset (`POST /staff/{id}/reset-credential`, ✱`staff.resetPasswords`) issues a **temporary credential of the account's method, shown once**, and sets `must_change_credential`.
6. **Audited actions** (immutable `audit_logs`, SR-7): protected-permission grants to Cashier, role and permission changes, staff create/edit/deactivate, `auth_method` changes, password/PIN set/change/reset, lockouts, refunds, discount application/authorization (incl. the ID-capture event, never the ID value), cancellations, inventory restock/adjust/correction, manual archive, automatic archive (system actor), restore, reprints, settings changes (all sections incl. compliance), retention configuration, setup completion, terminal registration/activation/reset/deactivation, offline reconciliation decisions.
7. **Extra Admin approval** for sensitive POS actions (discount, cancel, refund) **⚠ OPEN (Q-DSC-4, Q-AUTH-3)**. Until decided, the grant alone (`pos.applyDiscounts`, `pos.cancelOrders`, `pos.processRefunds`) governs. Any future approval flow must use the Admin's password, since Admin accounts cannot use a PIN (item 9).
8. **Staffing limits** (max admins / staff / terminals) apply to creation, re-activation and terminal activation, never retroactively (409 `LIMIT_REACHED`).
9. **Admin accounts cannot use a PIN** (422 `AUTH_METHOD_NOT_ALLOWED`); PIN sign-in only from an activated terminal (Q-AUTH-2).
10. **Setup wizard only while setup is incomplete.** `/setup/*` work only while `system_state.setup_status` ≠ `completed` (all other endpoints except `/health` → 409 `SETUP_REQUIRED`); after completion `/setup/*` permanently return (except read-only `GET /setup/status`, always readable) 409 `SETUP_ALREADY_COMPLETED`. Complete Setup is one atomic transaction (business + first Admin + status + audit); no default or shipped password (Q-AUTH-1 ★). Protecting the wizard on a network-reachable fresh install **⚠ OPEN (Q-AUTH-8 ★)** (risk AR-8).
11. **Terminal activation only with an Admin-issued one-time code** (Q-TRM-1). The code is the only authorization for `POST /terminals/activate`; it is single-use, short-lived, stored hashed, and invalidated by reset. Terminal identity is never taken from client input.
12. **Archive / restore Admin only** (✱`archive.manage`, Q-ARC-2 ★): manual archive (reason required), the cancelled-order review list, and restore within `archiving.restore_window` (expired → 409 `RESTORE_WINDOW_EXPIRED`). Automatic archiving of completed orders runs as the system actor (no user permission) and is audited (Q-ARC-4). Retention may not be set below `compliance.retention_minimum` (422 `RETENTION_BELOW_MINIMUM`, ⚖ VR-6).
13. **Offline reconciliation Admin only** (✱`sync.review`): resolving `needs_review` submissions is audited; the original submission is never modified (SR-4).
14. **Customer identification data** (discount ID capture: customer name, ID type, ID number — Q-DSC-3) is recorded only when the discount requires it, visible in full only to authorized roles, **masked in lists**, and **never included in real-time events** or audit payloads; printing on documents is a compliance setting. ⚖ VR-2, VR-7. *Interim safe behaviour — not a decision:* "authorized roles" = Admin until a dedicated key is decided (Q-SET-3); the capturing cashier sees only what they are entering. No field is claimed to be legally mandatory.
15. **Real-time events are filtered by the receiving session's permissions** (and feature gates); payloads are minimal and never contain credentials, ID numbers, activation codes, device credentials, or cost data for sessions without the corresponding permission (§5.3, risk AR-16).
16. **Offline actions use the session's permissions from the last sync** (cached effective permissions + feature flags), intersected with the limited offline scope (Q-TRM-3; details ⚠ OPEN Q-TRM-7 ★). The server **re-validates at sync** (SR-4): if the user was deactivated, the terminal revoked, or a required permission revoked in the meantime, the transaction is flagged `needs_review` — never silently applied or dropped.
17. **Refunds and non-cash payments are unavailable offline** (Q-TRM-3, Q-TRM-4: cash only). Also unavailable offline regardless of grants: cancelling or paying orders created online, restock/adjustments, catalog/settings/staff/terminal changes, archive/restore, analytics, expenses, terminal activation.

## 5. Enforcement design (backend)

### 5.1 Modules

- `core/permissions.py`: `PermissionKey` enum (48 + 10 gap keys), `PROTECTED` set, `ADMIN_ONLY` set (gap keys, until Q-SET-3), `DEFAULT_GRANTS`.
- `core/security.py`: credential hashing & verification per `auth_method`, token verification, device-credential verification → `CurrentSession(user, role, terminal, permissions, features)`.
- Router dependencies: `require(PermissionKey.X)` → 403 `PERMISSION_DENIED`; `require_feature(Feature.Y)` → 403 `FEATURE_DISABLED`.
- Services perform the non-configurable checks in §4, ownership checks (e.g. Account), state/version checks and all money recomputation (SR-2, SR-8).

### 5.2 Request pipeline (order of checks)

| # | Step | Failure |
|---|---|---|
| 1 | **Setup-state guard** (`system_state.setup_status`) | 409 `SETUP_REQUIRED` (non-setup endpoint before completion) / 409 `SETUP_ALREADY_COMPLETED` (`/setup/*` writes after completion) |
| 2 | **Session dependency** — access token → session exists and not ended | 401 `UNAUTHENTICATED` |
| 3 | **Idle-timeout check** — `now − last_activity_at` > `security.idle_timeout_minutes` → end session (`idle_timeout`) | 401 `SESSION_EXPIRED` |
| 4 | **Device-credential verification** — `X-Device-Credential` matches the session's terminal (`device_credential_hash`), terminal `active` | 403 `TERMINAL_NOT_ACTIVATED` |
| 5 | User still active | session ended (`user_deactivated`) → 401 `UNAUTHENTICATED` |
| 6 | Update `last_activity_at` (user-initiated requests only) | — |
| 7 | `require_feature` | 403 `FEATURE_DISABLED` |
| 8 | `require(permission)` | 403 `PERMISSION_DENIED` |
| 9 | **Idempotency** (required on `POST /orders`, payments, refunds, cancel, status → `completed`, restock/adjust) — same key + same request → stored outcome; same key + different request → 422 `IDEMPOTENCY_KEY_REUSED`. Checked **after** authorization, so a replay never bypasses a permission or feature check. | — |
| 10 | Service: §4 protections, state machine + `version` (409 `INVALID_TRANSITION` / `VERSION_CONFLICT`), locks, server-side money | per BUSINESS-RULES |
| 11 | Commit (+ audit + outbox event in the same transaction) → publish after commit, filtered per §5.3 | — |

Login (`POST /auth/login`) skips steps 2–6 but requires setup completed, a valid device credential for an active terminal, and the account's selected method (§1.1). Setup endpoints (`/setup/*`) and `POST /terminals/activate` are the only unauthenticated mutations; they are guarded by step 1 and by the activation code respectively.

### 5.3 Real-time event filtering (SR-1)

Transport ⚠ OPEN (Q-ARCH-3). The stream uses the same session (ends when the session ends; heartbeats do not refresh `last_activity_at`). Every event is filtered **per receiving session** before delivery; a grant change re-evaluates the filter.

| Channel | Delivered to sessions holding | Payload rule |
|---|---|---|
| orders | `orders.view` or `pos.view` | No customer ID data |
| payments | `payment.*` / `order.payment_status_changed`: `orders.view` or `pos.processPayments`; `refund.recorded`: `receipts.view` or `history.view` | Amounts/status; no customer ID data |
| inventory | `inventory.view` (unit stock) / `ingredients.view` (ingredient stock), plus ⚑ gate; `pos.view` sessions receive availability only (available/unavailable) | No cost fields without a cost-viewing permission |
| alerts | permission of the underlying entity (e.g. `orders.view` for `alert.order_overdue`; `inventory.view` for `stock.low` / `stock.out`, with `stock.out` availability also to `pos.view`) | — |
| settings | every authenticated session (settings are business-wide) | `settings.changed` carries section + version only; content is refetched through permission-checked `GET /settings` |
| terminals | `terminals.manage`; the affected terminal's own sessions for its own status | Never activation codes or device credentials |
| sessions | own session; others' sessions to `staff.view` | — |
| staff | `staff.view` | No credentials or hashes |
| sync | `sync.review` (`sync.review_required`); the submitting device for its own queue | No customer ID data |

### 5.4 Offline

- The POS snapshot (`GET /sync/snapshot`, ✱`pos.view`) carries the session's effective permissions and feature flags; the device enforces them locally while offline (UX only — the server re-validates everything).
- `POST /sync/transactions`: each queued transaction is checked against the permissions its actions require (e.g. `pos.createOrders`, `pos.processPayments`, `pos.applyDiscounts`, `orders.changeStatus`, `orders.complete`) **as they stand at sync**, plus user/terminal status; failure → `needs_review` (§4 item 16). Idempotency via `client_txn_id`.
- Reconciliation endpoints `/sync/reviews…` ✱`sync.review` (Admin only).

### 5.5 Frontend

Frontend `useAdminAccess` / `AdminGuard` / `ProtectedRoute` (currently empty stubs) only **mirror** the permission list, feature flags and `must_change_credential` returned by the server, for navigation and visibility. They never grant access; hidden UI is not a control, and every hidden action is still rejected by the server.

## 6. Action → permission / gate / offline map (Phase 3B flows)

| Action | ✱ Permission | ⚑ Gate | Offline |
|---|---|---|---|
| Create order + reserve stock (`POST /orders`, Q-ORD-1, Q-INV-2) | `pos.createOrders` (+ `pos.applyDiscounts` if a discount) | — | Allowed (from last snapshot) |
| Apply the one discount; ID capture when required (Q-DSC-1/3) | `pos.applyDiscounts` | Discounts | ⚠ Q-TRM-7 |
| Record payment, split, cash rounding (Q-PAY-1/2) | `pos.processPayments` | — | Cash only (Q-TRM-4) |
| Confirm / void pending payment | `pos.processPayments` (confirm meaning ⚠ Q-PAY-3) | — | ✖ |
| Change status | `orders.changeStatus` | — | Own offline orders; online orders ⚠ Q-TRM-7 |
| Complete (requires settlement, 409 `ORDER_NOT_SETTLED`) | `orders.complete` | — | Own offline orders only |
| Cancel (releases reservation; paid order ⚠ Q-CAN-1) | `pos.cancelOrders` 🔒 | — | Online orders ✖; own offline orders ⚠ Q-TRM-7 |
| Edit placed order | `pos.editOrders` (⚠ Q-ORD-2 — not implemented until decided) | — | ✖ |
| Refund, full/partial (Q-REF-1) | `pos.processRefunds` 🔒 | Refunds | ✖ |
| View / reprint sales document (Q-RCP-1) | `receipts.view` / `receipts.reprint` | — | Reprint ⚠ Q-TRM-7; offline prints only a provisional slip (⚠ Q-RCP-5, ⚖ VR-3) |
| Restock / adjust (reject below reserved, 409 `STOCK_RESERVED`) | `inventory.restock` / `inventory.adjust` / `ingredients.adjust` 🔒 | Inventory / Ingredient Tracking | ✖ |
| Manual archive / restore (Q-ARC-1/2/4) | `archive.manage` (Admin only) | — | ✖ |
| Staff create/edit incl. `auth_method`; reset credential | `staff.add` / `staff.edit` / `staff.resetPasswords` 🔒 | — | ✖ |
| Register / deactivate / reset terminal | `terminals.manage` (Admin only) | — | ✖ |
| Activate terminal (device) | one-time activation code (no user permission) | — | ✖ |
| Settings sections | `settings.<section>`; permissions → `staff.managePermissions`; security/archiving/offline/compliance/terminology gap keys (Admin only) | — | ✖ |
| Offline sync review | `sync.review` (Admin only) | — | — |
| Audit log | `audit.view` (Admin only) | — | ✖ |
| First-run setup (Q-AUTH-1) | none — setup-state guard only (⚠ Q-AUTH-8) | — | — |

## 7. Current UI vs this model (temporary — do not change in Phase 3B)

- Settings → Permissions shows only the 48 keys; the 10 gap keys have no UI (Q-SET-3). Permissions are configuration only today; nothing is enforced.
- Login has no PIN mode, no terminal activation and no setup wizard; Staff has no `auth_method` selector; no Settings screens for security / archiving / offline / compliance; the terminal list is fixed (REG-01…03, C-11). To be revised in a later UI/integration phase (SR-10).
- `useAdminAccess`, `AdminGuard`, `ProtectedRoute` are empty stubs; once implemented they only mirror server-returned permissions (§5.5).
