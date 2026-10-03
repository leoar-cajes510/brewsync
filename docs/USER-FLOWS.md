# BrewSync — User Flows

> Status: **Phase 3B (2026-09-27) — architecture blueprint.** Nothing below is implemented yet. Describes the intended **real** behaviour of each screen once the backend exists.
> Decision status (DECIDED / ⚠ OPEN, Q-IDs) lives in [DECISIONS.md](DECISIONS.md). Rules are in [BUSINESS-RULES.md](BUSINESS-RULES.md) and cited by section (e.g. "BUSINESS-RULES §7"). Architecture: [SYSTEM-LOGIC.md](SYSTEM-LOGIC.md) §10 real-time, §11 concurrency, §12 offline, §13 compliance. Permissions: [PERMISSIONS.md](PERMISSIONS.md). Endpoints: [API.md](API.md). Tables: [DATABASE.md](DATABASE.md).
> The current frontend still shows temporary demo/mock data and some superseded behaviour. It is **not** changed in Phase 3B. It is replaced during the integration phase (SYSTEM-LOGIC §8). Each flow marks these gaps as **UI today:**.

Legend: **→** step · **⇢** server call · **✱** permission required · **⚑** feature gate · **★** high priority · **⚖** needs legal/business verification (VR-ID) · **⚠ OPEN (Q-ID)** not decided

**Rules that apply to every flow**
- **Server is authoritative (SR-2).** The client may show an optimistic state, but the server result wins. If the server rejects an action, the client reverts and shows the reason. The server never trusts client totals, prices, stock, discounts, tax, permissions or payment status. It recalculates them from stored data (SR-8).
- **Money** is decimal with 2 decimal places. The server rounds using one policy (Q-TAX-3, BUSINESS-RULES §0). The client never rounds an authoritative value.
- **Idempotency-Key** is required on order creation, payments, refunds, cancellation, completion, and restock/adjust. A retry with the same key returns the stored result. Reusing a key with a different body returns 422 IDEMPOTENCY_KEY_REUSED.
- **Concurrency (SR-3).** Order actions send `expected_version`. A stale version returns 409 VERSION_CONFLICT. An invalid state change returns 409 INVALID_TRANSITION. In both cases the client refetches and shows the current state.
- **Real-time (SR-1).** While online, screens update from server events (SYSTEM-LOGIC §10). The transport is ⚠ OPEN (Q-ARCH-3). After a gap, the client resumes from `last_sequence`; RESYNC_REQUIRED means refetch.
- **Audit (SR-7).** Every critical action creates an immutable audit record. **History (SR-6)** is never hard-deleted.
- **Error envelope:** `{ error: { code, message, details } }` with the codes listed in API.md.

---

## 1. First-run setup wizard
Q-AUTH-1 ★ (DECIDED). BUSINESS-RULES §18.

**Fresh Installation → Business Setup → Create First Admin → Complete Setup → Login**

1. **Fresh installation.** The device opens BrewSync ⇢ `GET /setup/status`. If `system_state.setup_status` is `not_started` or `in_progress`, the wizard is shown instead of Login. Nothing else is usable: every endpoint except `/setup/*` and `/health` returns 409 SETUP_REQUIRED.
2. **Business Setup.** The owner enters the business identity: name, type, address, phone, email, currency, timezone ⇢ `POST /setup/business`. The server validates the input and sets status to `in_progress`.
3. **Create First Admin.** The owner enters full name, username (`^[a-z0-9._-]{3,20}$`), password and confirm ⇢ `POST /setup/admin`.
   - The authentication method is always `password` (Admin accounts cannot use PIN, Q-AUTH-2).
   - The owner chooses the password. **There is no default or shipped password.**
   - Password length, complexity and lockout values are ⚠ OPEN (Q-AUTH-7 ★).
4. **Complete Setup.** The owner reviews the entries ⇢ `POST /setup/complete`. One atomic transaction creates:
   - the business row
   - the first Admin
   - `setup_status = completed`
   - an audit record (setup completion)

   Nothing else is created. No products, stock, staff, orders or other business data (SR-9).
5. **Login.** The wizard closes and the Admin signs in (§3). *Interim safe behaviour — not a decision:* every sign-in, including Admin, requires an activated terminal; how the first device is activated after setup is ⚠ OPEN (Q-TRM-8 ★) and must be decided before this step can work. Next steps are in §22.

**Setup guard**
- Before completion: only `/setup/*` and `/health` respond.
- After completion: `/setup/*` always returns 409 SETUP_ALREADY_COMPLETED. The wizard can never be run again.
- If the wizard is abandoned before Complete Setup, no business data is committed and the wizard reappears.

**Open**
- ⚠ OPEN (Q-AUTH-8 ★): how the wizard is protected on a fresh install that can be reached over the network (risk AR-8).
- ⚠ OPEN (Q-TRM-8 ★): how the setup device becomes the first terminal, and how the Admin gets access before any terminal is activated.

**Failures:** 422 VALIDATION_ERROR (field errors are shown inline; the step stays open) · 409 SETUP_ALREADY_COMPLETED (redirect to Login).

**UI today:** there is no setup wizard. Login is shown directly.

## 2. Terminal registration & device activation
Q-TRM-1 ★ (DECIDED). BUSINESS-RULES §14.

1. **Register.** Admin ✱`terminals.manage` (Admin-only until Q-SET-3) ⇢ `POST /terminals` with code and name.
   - The terminal is created with status `pending_activation`.
   - The response contains a **one-time, short-lived activation code**. It is shown once only; the server stores only its hash and expiry (`activation_expires_at`).
   - The registration is audited.
2. **Hand over.** The Admin enters the code on the physical device, or gives it to whoever sets the device up.
3. **Activate.** On the device, the device-setup screen asks for the code ⇢ `POST /terminals/activate`. The server checks that:
   - the code hash matches, is unexpired and unused
   - the terminal is `pending_activation`
   - Staffing → Maximum Active Terminals is not exceeded
4. **Bind.** The server issues a **device credential**. The secret stays on the device; the server stores only its hash.
   - The terminal becomes `active` (`activated_at`, `activated_by`).
   - The activation is audited and `terminal.status_changed` is published.
5. **Use.** Every login from this device sends `X-Device-Credential`. The server derives the terminal from this credential and never from a code the client supplies, so a device cannot claim an arbitrary terminal.

**Reset activation** ⇢ `POST /terminals/{id}/reset-activation` ✱`terminals.manage`
- Revokes the device credential and ends sessions on the terminal (`end_reason = terminal_revoked`).
- Issues a new one-time code. Status returns to `pending_activation`.
- Use it when a device is replaced, when browser storage was cleared, or when a cloned credential is suspected (AR-7).
- Audited.

**Deactivate** ⇢ `POST /terminals/{id}/deactivate`
- Status becomes `inactive` and sessions end.
- Sign-in from the device returns 403 TERMINAL_NOT_ACTIVATED.
- Reactivation re-checks the Maximum Active Terminals limit.
- Audited.

**Statuses:** `pending_activation` · `active` · `inactive` · `revoked` (credential revoked; the device must be activated again with a new code).

**Limit:** Staffing → Maximum Active Terminals (1–25) is enforced at activation and reactivation, never retroactively. Lowering the limit below current usage only blocks new activations.

**Delete:** allowed only if the terminal was never referenced; otherwise deactivate it (Q-DEL-1).

**Staff assignment:** a staff member's "default terminal" is a sign-in preference only. Restricting staff to assigned terminals is ⚠ OPEN (Q-TRM-6).

**Failures:** 400 ACTIVATION_CODE_INVALID (wrong, expired or already used code) · 409 LIMIT_REACHED ("Terminal limit reached — contact Admin") · 403 PERMISSION_DENIED.

**UI today:** there is no terminal management screen and no device activation step. Staff uses a fixed prototype list `REG-01…REG-03` (C-11). Both are replaced in a later UI phase.

## 3. Login, sessions & idle timeout
Q-AUTH-2 ★, Q-AUTH-4 ★ (DECIDED). BUSINESS-RULES §14.

**Sign in**
1. BrewSync opens on an activated device and shows Login (no sidebar).
   - If the device has no valid credential, it shows device activation (§2).
   - If setup is not complete, it shows the setup wizard (§1).
2. The user enters a username and credential. The UI offers a password field or a PIN pad ⇢ `POST /auth/login` with `X-Device-Credential`.
   - Each account uses one method, `users.auth_method` ∈ {`password`, `pin`}.
   - **Admin:** username + password only.
   - **Cashier:** username + PIN, or username + password, as selected per account by an Admin in Staff (§18).
   - The server accepts only the account's selected method. A credential of the other type fails the same way as a wrong credential.
3. The server checks, in order:
   - setup completed
   - device credential valid and terminal `active` (otherwise 403 TERMINAL_NOT_ACTIVATED)
   - user exists and is active
   - account not locked (otherwise 423 ACCOUNT_LOCKED)
   - credential verified against the adaptive hash
   - PIN sign-in only from an activated terminal
4. Failed attempts are counted. Lockout follows the credential policy (values ⚠ OPEN Q-AUTH-7 ★). Lockouts are audited.
5. On success, the server:
   - resets the failure counter
   - creates a session (user + terminal, `last_activity_at`) and publishes `session.started`
   - returns an access token (plus an httpOnly refresh cookie), the user profile, role, **effective permission keys**, enabled features, and the business-wide settings bundle, including preferences and the idle timeout
6. If `must_change_credential` is set, the user must set a new password (⇢ `POST /auth/change-password`) or PIN (⇢ `POST /auth/change-pin`) before doing anything else.
7. The frontend keeps the token in memory and hides what the role cannot use. This is UX only; the server enforces every call.
8. Landing screen: Cashier → POS. Admin → POS, or Admin Overview (⚠ OPEN Q-AUTH-3).

**Idle timeout** (server-enforced)
- The timeout is `security.idle_timeout_minutes`, business-wide, chosen from an allowed list. Approved candidate values are 5, 10, 15, 30 and 60 minutes; the default is ⚠ OPEN (Q-SET-4).
- The server updates `last_activity_at` only on user-initiated requests. Real-time heartbeats and background refreshes do not count.
- On every request, if the session has been idle longer than the timeout, the server ends it (`end_reason = idle_timeout`) and returns 401 SESSION_EXPIRED. The client then shows Login with the username pre-filled.
- The client countdown is UX only (it may warn or lock the screen early). It never extends the session.
- While offline, the timeout is enforced locally (AR-3, §20).

**Lock** ⇢ `POST /auth/lock`
- Ends the working session (`end_reason = lock`) and returns to Login with the username pre-filled.
- The same user signs back in with their credential ⇢ `POST /auth/unlock`, which creates a new session (the locked one stays ended). Unlock while offline is part of ⚠ OPEN Q-TRM-7. Any other user signs in normally.

**Log Out** ⇢ `POST /auth/logout`
- Ends the session (`end_reason = logout`) and publishes `session.ended`.
- Planned mitigation (AR-6): Log Out is blocked while the device holds unsynced offline transactions (§20).

**Sessions ended by others**
- User deactivated in Staff → `user_deactivated`.
- Terminal reset or deactivated → `terminal_revoked`.
- Administrative termination → `forced`.

The affected screen returns to Login with a reason.

**Concurrent sessions per user** (the same user on two terminals): ⚠ OPEN (Q-AUTH-6).

| Failure | Code | Shown |
|---|---|---|
| Wrong username / credential / wrong credential type | 401 UNAUTHENTICATED | Generic "Invalid username or credential"; attempt counted, rate-limited |
| Account locked | 423 ACCOUNT_LOCKED | "Account locked — try later or contact Admin" |
| Inactive user | 401 UNAUTHENTICATED | "Account inactive — contact Admin" |
| Device not activated / terminal inactive or revoked | 403 TERMINAL_NOT_ACTIVATED | Device activation screen (§2) |
| Admin account set to PIN | 422 AUTH_METHOD_NOT_ALLOWED (at Staff save) | Cannot occur at login |
| Setup incomplete | 409 SETUP_REQUIRED | Setup wizard (§1) |
| Idle / expired session | 401 SESSION_EXPIRED | Login, username pre-filled |

**UI today:**
- Login has no PIN mode, no terminal activation and no setup wizard, and the submit does not authenticate.
- "Lock" only navigates to `/login`.
- There is no idle timer.

## 4. POS — create order (pay-later)
Q-ORD-1 ★, Q-INV-2 ★, Q-INV-3 ★, Q-DSC-1/2/3, Q-TAX-1/2/3 (DECIDED). BUSINESS-RULES §2, §4, §5, §6.

**Flow:** POS → Order Created → Pending → Preparing → Ready for Pickup → Payment → Completed. Unpaid orders are valid active orders.

1. **Catalog** ⇢ `GET /pos/catalog` ✱`pos.view` returns:
   - active categories
   - active, available products (price, image, **availability**)
   - linked choice groups and options
   - active discounts, including `requires_identification` and `identification_fields`
   - tax and payment settings
   - preferences (default order type, show order-type selector)
   - `catalog_version`

   Availability is `min(unit available, ingredient-limited available)` for products with `track_units` and/or `track_ingredients`, where `available = on_hand − reserved`.

   Real-time `stock.changed`, `stock.low` and `stock.out` update availability as they arrive. If there is no active product or no enabled payment method, POS shows an empty state (§22).
2. **Choices.** Tap a product. If it has choice groups, the choice selector opens and validates single/multi, required and min/max (BUSINESS-RULES §2) → Add to cart. Unavailable products are disabled.
3. **Cart**
   - Change quantity or remove a line. A confirmation appears if Preferences → Confirm Before Removing Cart Item is on.
   - Identical lines (same product and same options) are merged.
   - Order type: Dine In / Takeout / Delivery. The selector is visible when "Show Order Type at Checkout" is on; the default comes from Preferences.
   - Table or delivery tag. Whether it is required is ⚠ OPEN (Q-ORD-4).
   - Customer name (optional; ⚠ OPEN Q-ORD-5 ⚖ VR-7).
   - Note.
4. **Discount** ✱`pos.applyDiscounts` ⚑Discounts
   - Choose **one** active discount. Only one discount per order (Q-DSC-1); choosing another replaces it. There are no per-item discounts.
   - If the discount has `requires_identification`, the POS asks for the configured `identification_fields` (a subset of customer name, ID type and ID number). The order cannot be placed until they are filled.
   - ID values are masked after entry, stored only on the order's discount snapshot, visible only to authorized roles, and never sent in real-time events. No field is claimed to be legally mandatory. ⚖ VR-2, VR-7.
   - Senior Citizen and PWD discounts are ordinary configurable discounts (Q-DSC-2). Any statutory treatment is a separate compliance rule (`compliance.statutory_rules`, disabled by default). ⚖ VR-1.
   - Whether a discount needs Admin approval is ⚠ OPEN (Q-DSC-4).
5. **Quote** ⇢ `POST /orders/quote` (lines, order type, discount + identification presence). The server returns:
   - subtotal
   - discount amount
   - tax per tax class, computed after the discount (Q-TAX-2)
   - total
   - availability warnings

   The quote is for display only. Totals are recalculated when the order is created. Tax rate and mode come from Settings → Tax; nothing is hard-coded. ⚖ VR-4.
6. **Place order** ✱`pos.createOrders` ⇢ `POST /orders` with **Idempotency-Key**. In one transaction the server:
   - recomputes every price from product and option IDs (client prices are ignored) and validates lines, choices, the single discount (min order, identification) and tax
   - locks the affected stock rows in a deterministic order
   - **reserves all unit and ingredient stock atomically** (all-or-nothing; `reservation` movements, reserved +q)
   - assigns the order number (`orders.number`)
   - creates the order: `status = pending`, `payment_status = unpaid`, `refund_status = none`, `origin = online`, `version = 1`
   - stores the discount snapshot (`order_discounts`, including ID fields when required)
   - writes an audit record for the discount application (the ID capture is recorded as an event, not the ID value)
   - writes `order.created` and `stock.changed` (plus `stock.low` / `stock.out` where a threshold is crossed) to the outbox, then commits
7. **Success.** The order number is shown and the cart is cleared. The order appears on the Orders board on every terminal (§5).
   - No sales document is issued yet. It is issued at full settlement (§6).
   - Whether a slip or bill is printed before payment is ⚠ OPEN (Q-RCP-3) ⚖ VR-3.
8. **Paying immediately.** Payments may be recorded at any point between creation and completion; the canonical point is Ready for Pickup (§6). Whether the POS offers a "pay now" step right at order creation is ⚠ OPEN (Q-ORD-6).

| Failure | Code | Result |
|---|---|---|
| Empty cart | 400 EMPTY_CART | Nothing created |
| Not enough stock (unit or ingredient) | 409 INSUFFICIENT_STOCK + offending items | Cart marks the items; **nothing reserved** |
| Product/option inactive, invalid choice, price changed | 422 VALIDATION_ERROR | Cart re-quotes and shows the reasons |
| Below discount minimum order | 422 DISCOUNT_MIN_ORDER | Discount removed or order adjusted |
| Missing identification | 422 IDENTIFICATION_REQUIRED | ID form re-opened |
| Second discount | 409 DISCOUNT_ALREADY_APPLIED | Only one allowed |
| Discounts feature off / permission missing | 403 FEATURE_DISABLED / PERMISSION_DENIED | Action unavailable |
| Retry after timeout (same key) | — | Original order returned; no second reservation |

On any failure, no order exists and nothing is reserved. An order number consumed by a rolled-back attempt leaves a gap, which is acceptable (BUSINESS-RULES §1).

Offline variant: §20.

**UI today:**
- POS is **pay-first**: "Charge" takes one full payment before the order exists (C-7, resolved in docs).
- There are no ID-capture fields in the discount selector.
- Totals come from `posMockData.ts` using the mock `MOCK_VAT_RATE = 0.12`, which must be replaced by server quotes.

## 5. Orders board
Q-ORD-1 ★ (DECIDED), SR-1, SR-3. BUSINESS-RULES §1, §20.

1. ⇢ `GET /orders?status=pending,preparing,ready` ✱`orders.view`, plus a real-time subscription on the orders, payments and alerts channels:
   - `order.created` · `order.status_changed` · `order.cancelled` · `order.completed`
   - `payment.recorded` · `payment.confirmed` · `payment.voided` · `order.payment_status_changed`
   - `alert.order_overdue`

   How Features → Live Updates and Preferences → Live Updates / Auto Refresh combine is ⚠ OPEN (Q-SET-2).
2. **Columns:** Pending · Preparing · Ready for Pickup. Each card shows:
   - order number, type/tag, items, age
   - **payment badge** from the server's `payment_status`: Unpaid / Partially paid / Paid
   - **overdue** flag when the order has waited longer than Staffing → Order Waiting Threshold (BUSINESS-RULES §1)
   - an "Offline" marker for `origin = offline` orders after they have been synced
3. **Actions.** Each sends ⇢ `POST /orders/{id}/status` with `{ target, expected_version }`.
   - ✱`orders.changeStatus`: Start (Pending → Preparing) · Mark Ready (Preparing → Ready for Pickup) · Undo last step (audited). Forward skips follow BUSINESS-RULES §1.
   - ✱`pos.processPayments`: Collect payment (§6).
   - ✱`orders.complete`: Complete (§7). Requires `paid`; normally from Ready for Pickup (forward skips per BUSINESS-RULES §1).
   - ✱`pos.cancelOrders`: Cancel with reason (§7).
4. **Conflicts.** Two terminals may act on the same order.
   - A stale version returns 409 VERSION_CONFLICT; an invalid transition returns 409 INVALID_TRANSITION.
   - The card reverts its optimistic move, shows "Order was changed on another terminal", and refreshes from the server.
   - Double completion is impossible: the order row is locked and completion checks status and settlement.
5. **Details panel:** items with choices, discount (ID values masked), subtotal, discount, tax and total, the payment list with statuses, remaining balance, and actions.
6. Completed orders leave the board and appear in History. Cancelled orders leave the board and appear in History and in the Admin cancelled-orders review list (§16).
7. **Stale unpaid orders** hold reserved stock (AR-10). They stay visible with an overdue flag. No automatic cancellation is decided.

**UI today:**
- The board uses `ordersMockData.ts`.
- The PaymentPanel takes one full payment only.
- Status changes are local.

## 6. Payment
Q-PAY-1 ★, Q-PAY-2 (DECIDED). BUSINESS-RULES §7, §8.

Entry: order details on the Orders board → **Collect payment** ✱`pos.processPayments`. The canonical point is Ready for Pickup, but a payment can be recorded any time between creation and completion.

1. The panel shows server values: total, completed payments, pending payments, and **remaining balance = total − completed − pending**.
2. Choose an enabled method. Methods are listed in Settings → Payments order.
3. Enter the amount. It defaults to the remaining balance; a smaller amount means a **split payment**.
   - **Cash**
     - Enter the cash tendered (required when "Require Cash Received" is on).
     - The server computes `change_given = tendered − amount`. The client never computes it authoritatively.
     - **Cash rounding** applies when `payments.cash_rounding.enabled` is on **and** this cash payment settles the whole remaining balance. The server rounds the remaining balance per `increment` and `mode` (nearest / down / up) and stores `rounding_adjustment = remaining − collected` on the payment. The order total is not changed.
     - The document shows a rounding line according to display and compliance settings. Partial cash payments and non-cash payments are always exact. ⚖ VR-5.
     - "Open Cash Drawer" is a device action when the payment completes (printing and device integration ⚠ OPEN Q-ARCH-4).
   - **GCash / Card / Bank Transfer**
     - The exact amount is charged.
     - A reference (4–40 characters, trimmed) is needed when the method's `require_reference` is on.
     - If `require_confirmation` is on, the payment stays `pending` until confirmed ⇢ `POST /payments/{id}/confirm`. What confirmation means is ⚠ OPEN (Q-PAY-3 ★).
     - A pending payment can be voided ⇢ `POST /payments/{id}/void`.
     - Pending payments reduce the remaining balance, which prevents overpayment, but they do not count toward settlement.
4. ⇢ `POST /orders/{id}/payments` with **Idempotency-Key**. The server:
   - locks the order row and recomputes the remaining balance
   - validates the method, amount, tender and reference
   - creates an immutable payment record
   - recomputes `payment_status` (`unpaid` → `partially_paid` → `paid`)
   - publishes `payment.recorded` and `order.payment_status_changed`
5. Repeat until the remaining balance is 0. Example: total ₱500 → Cash ₱300 (tendered ₱500, change ₱200) → GCash ₱200 (with reference) → **Paid**.
6. **Sales document at full settlement.** The document is issued in the same transaction as the payment that settles the order, meaning the payment that becomes `completed` when recorded or when confirmed. Settlement means Σ completed (`amount` + `rounding_adjustment`) = total.
   - The number comes from `document_series`, allocated under a row lock. Gap-free numbering within a series is a technical design goal.
   - The document stores a snapshot with `document_type = sales` and `status = issued`.
   - The document title and type are configured in compliance settings. BrewSync does not assume the document is an "Official Receipt" and claims no BIR compliance. ⚖ VR-3.
   - It is printed or shown per Settings → Receipts format (printed / digital).
7. Payment does **not** complete the order. Completion is a separate step (§7). "Return to POS After Payment" is a UI behaviour only.
8. Completed payments are never edited. Money is returned only through a refund (§10).

| Failure | Code |
|---|---|
| Amount above remaining balance (incl. pending) | 422 OVERPAYMENT |
| Cash tendered below amount | 422 INSUFFICIENT_TENDER |
| Reference missing when required | 422 REFERENCE_REQUIRED |
| Method disabled (offline non-cash is handled at sync, §20) | 422 METHOD_NOT_ENABLED |
| Order cancelled / completed | 409 INVALID_TRANSITION |
| Two terminals paying at once | Order row lock. The second request sees the new balance and may get OVERPAYMENT (AR-15). |
| Retry with same key | Stored result; no duplicate payment |

Offline: cash only, and only for orders created offline on the same terminal (§20).

**UI today:**
- POS Charge and the Orders PaymentPanel accept **one full payment** only. There is no split and no remaining-balance display.
- There is no cash rounding UI.
- Confirmation is a local checkbox.

## 7. Completion & cancellation
Q-ORD-1 ★, Q-INV-2 ★ (DECIDED). BUSINESS-RULES §9, §11.

**Complete** ✱`orders.complete` ⇢ `POST /orders/{id}/status` with `{ target: completed, expected_version }` and **Idempotency-Key**
1. The server locks the order and checks that the transition is allowed (`ready`, or a permitted forward skip from `pending`/`preparing`, BUSINESS-RULES §1) and that `payment_status` is `paid`.
   - Not settled → 409 ORDER_NOT_SETTLED.
   - Wrong status → 409 INVALID_TRANSITION.
2. `status = completed`, `completed_at` is set.
3. The **reservation becomes the sale**: `sale` movements (on_hand −q and reserved −q) for units and ingredients.
4. Events `order.completed` and `stock.changed` are published.
5. The order leaves the board, appears in History, and becomes eligible for automatic archival (§16).

Preferences → Automatically Clear Completed Order / Return to POS are UI behaviours only. A duplicate complete request returns the stored result or INVALID_TRANSITION. It never completes twice.

**Cancel** ✱`pos.cancelOrders` (protected; off for Cashier by default) ⇢ `POST /orders/{id}/cancel` with `{ reason (required, ≤ 200 chars), expected_version }` and **Idempotency-Key**
1. Allowed from Pending, Preparing and Ready for Pickup. The Preferences confirmation prompt is UI only.
2. **Unpaid order:**
   - `status = cancelled`
   - the **reservation is released** (`reservation_release` movements, reserved −q)
   - audited; `order.cancelled` and `stock.changed` published
3. **Paid or partially paid order** (any completed payment): ⚠ OPEN (Q-CAN-1 ★). This interacts with the Refunds toggle (C-19, AR-14).
   - *Interim safe behaviour — not a decision:* the server rejects cancellation of an order with completed payments (409 CONFLICT) and the order stays active. Pending payments are voided before an unpaid order is cancelled.
4. Cancelled orders are never auto-archived. They wait in the Admin cancelled-orders review list (§16).

Completed and cancelled are final states. A completed order can only be refunded (§10).

**UI today:** because POS is pay-first, every current order is already paid. Cancel and complete only change local state.

## 8. Receipts (sales documents)
Q-RCP-1, Q-RCP-2 ★ (DECIDED). BUSINESS-RULES §8.

The UI label is "Receipts". The backend object is the **sales document** (`documents`; API `/documents`).

1. ⇢ `GET /documents?date=…&status=…&q=…` ✱`receipts.view`. Today is shown by default. Search covers document number and order number, which are separate identifiers.
   - Statuses: `issued` · `partially_refunded` · `refunded` · `void` (void only if verified rules allow ⚖ VR-3).
   - Types: `sales` · `refund`.
2. **Preview.** Select a document to see a preview rendered from its **stored snapshot**, never from current settings. Later settings changes never alter an issued document. The snapshot contains:
   - business header
   - items with choices
   - discount (ID values masked; printing ID values is a compliance setting ⚖ VR-2, VR-7)
   - tax lines per display and compliance settings
   - payments: method, reference, tendered, change, rounding line
   - cashier, terminal, order number, document number, issued time
   - the configured texts
3. **Reprint** ✱`receipts.reprint` ⇢ `POST /documents/{id}/reprint`
   - **Same number and content.** `print_count` +1, a `document_prints` row, and an audit record.
   - A reprint marker is printed using the text from compliance settings ⚖ VR-3.
   - A reprint never creates a new transaction or number. Reprinting while offline is ⚠ OPEN (Q-TRM-7).
4. **Refund** (only when ⚑Refunds is ON, the user has ✱`pos.processRefunds`, and the order is completed) → §10.

Mandatory document content, titles and numbering rules are compliance configuration. They are not decided here. ⚖ VR-3.

**UI today:** the list comes from `receiptsMockData.ts` (including a mock business header). Reprint and refund only change local state.

## 9. History
BUSINESS-RULES §16, §22.

1. ⇢ `GET /history` ✱`history.view`. Filters:
   - date range, cashier, terminal, payment method, order type, origin (online / offline)
   - status: completed / cancelled
   - refund status: none / partially refunded / refunded
   - search: order number, document number, customer

   Archived orders are hidden by default and shown with the "Archived" filter.
2. **Summary** for the filtered set, computed by the server: transaction count, gross, refunds, net.
3. **Row → transaction details:**
   - items and choices
   - discount snapshot (ID masked)
   - tax
   - all payments, including splits and rounding adjustments
   - sales document(s)
   - refunds with lines and allocations
   - cashier, terminal, timestamps
   - audit trail (✱`audit.view`)

   Actions: **Reprint** (§8) · **Refund** (§10).
4. **Export CSV** ✱`history.export` (Admin-only until Q-SET-3).

History is read-only. Records are never edited or hard-deleted (SR-6). Historical refunds stay visible even when Refunds is OFF.

**UI today:** data comes from `historyMockData.ts`.

## 10. Refunds
Q-REF-4, Q-REF-1 ★ (DECIDED). BUSINESS-RULES §10.

**Gate:** Settings → Features → **Refunds** ⚑.
- **OFF:** refund actions are hidden and refund endpoints return 403 FEATURE_DISABLED. Past refunds remain visible.
- **ON:** users with ✱`pos.processRefunds` (protected; off for Cashier by default) may refund.
- Whether a refund also needs Admin approval is ⚠ OPEN (Q-DSC-4 / Q-AUTH-3).

**Scope:** only **completed** orders. Returning money on a paid order that is not completed is ⚠ OPEN (Q-CAN-1 ★).

1. From Receipts (§8) or History (§9) → **Refund**.
2. **Full or partial.** Both are allowed. How a partial refund is specified (by line/quantity or arbitrary amount) is ⚠ OPEN (Q-REF-5 ★). *Interim safe behaviour — not a decision:* only full refunds are implemented until Q-REF-5 is decided (BUSINESS-RULES §10).
3. **Reason** (required).
4. **Refund method, time limit, and allocation across split payments:** ⚠ OPEN (Q-REF-2 ★) ⚖ VR-8.
5. **Restock returned items:** ⚠ OPEN (Q-REF-3). If restocked, `sale_reversal` movements reference the refund.
6. ⇢ `POST /orders/{id}/refunds` with **Idempotency-Key**. The server:
   - locks the order and **computes the refund amount itself**; any client amount is only a request
   - checks Σ refunds ≤ Σ completed payment `amount` (otherwise 422 REFUND_EXCEEDS_REFUNDABLE)
   - creates a **separate, immutable refund record** (`refunds`, `refund_lines`, `refund_allocations`) linked to the order, its sales document and the returned payment(s)
   - updates the order `refund_status` (`partially_refunded` / `refunded`) and the document status
   - writes an audit record and publishes `refund.recorded`
7. **Refund document** (`document_type = refund`). Title, numbering and content are set in compliance configuration ⚖ VR-3. It is printed or shown per Settings → Receipts format.

The original order, payments and document snapshot are **never edited**. Analytics subtract refunds on the refund date. Refunds are not available offline.

**UI today:** History refunds the full amount only, with local state (C-6 resolved: partial refunds are added later).

## 11. Admin → Products
Q-INV-1 ★, Q-TAX-1, Q-DEL-1 (DECIDED). BUSINESS-RULES §3, §4, §6.

1. ⇢ Product list ✱`products.view`: search, category, status, availability.
2. **Add / Edit** ✱`products.create` / `products.edit`:
   - name, category, price, description
   - **code**: not typed. The server generates `PREFIX-NNN` from the category's code prefix on save (e.g. `COF-001`); the form shows "Auto-generated on save · Example: COF-###" and, when editing, the code read-only. Codes never change — not on edit, not on a category rename, not when the product moves to another category.
   - a **new category** typed in the form, or added in **Categories**, needs a code prefix (e.g. Coffee → `COF`), fixed once created
   - image upload (storage ⚠ OPEN Q-ARCH-2)
   - available, active
   - **choice groups to attach**
   - **`track_units`**: sellable unit stock, gated by ⚑Inventory. Initial stock is entered once at creation as an `initial` movement.
   - **`track_ingredients`**: recipe consumption, gated by ⚑Ingredient Tracking. The recipe is built in §14.
   - **`tax_class`**: baseline `taxable` / `non_taxable`. Any further classes are compliance configuration ⚖ VR-4.
3. **Tracking combinations.** Either flag, both, or neither. When both are set, **both** stocks must be sufficient and POS availability is the minimum of the two. Behaviour when a tracking feature is disabled is ⚠ OPEN (Q-FEAT-1).
4. Price and option changes affect **new** orders only. Existing orders and documents keep their snapshots.
5. **Duplicate** creates a new product with no stock (no initial stock is copied) and a fresh generated code from its category (`COF-007` → `COF-008`, never `-COPY`).
6. **Activate / Deactivate.** Deactivated products disappear from POS but stay in history and analytics.
7. **Delete** ✱`products.delete`: a hard delete is allowed only if the product was **never referenced** (orders, movements, recipes). Otherwise the server returns 409 CONFLICT and the UI offers **Deactivate** instead. The same rule applies to categories.

**UI today:**
- The product form has no `track_units` / `track_ingredients` / `tax_class` fields and no choice-group link.
- The POS and Admin product types are separate.
- The data lives in `catalogStore` (in-memory).

## 12. Admin → Inventory
Q-INV-2 ★, Q-INV-3 ★ (DECIDED). BUSINESS-RULES §3, §4. ⚑Inventory.

1. ⇢ `GET /inventory` ✱`inventory.view` shows products with `track_units`:
   - **on_hand**, **reserved** (held by open orders), **available = on_hand − reserved**
   - status in / low / out (BUSINESS-RULES §3), threshold, last restock
   - movement history: `initial` · `restock` · `adjustment` · `correction` · `waste` · `reservation` · `reservation_release` · `sale` · `sale_reversal`, each with `on_hand_after` / `reserved_after`
2. **Restock** ✱`inventory.restock` (**Idempotency-Key**)
   - Quantity > 0, unit, optional note (≤ 200 characters), optional unit cost.
   - Creates a `restock` movement (on_hand +q). Audited.
3. **Adjust** ✱`inventory.adjust` (**Idempotency-Key**)
   - Signed quantity ≠ 0, a reason (Count Correction / Damaged / Lost / Other), and a note.
   - Creates an `adjustment`, `correction` or `waste` movement. Audited.
   - An adjustment may **not** reduce on_hand below reserved: 409 **STOCK_RESERVED** ("n units are reserved by open orders").
   - An adjustment below 0 is rejected, **never clamped**.
   - To record a physical loss of reserved stock, first cancel or handle the affected orders (AR-11).
4. **Edit threshold** ✱`inventory.adjust`. Which default applies to new items is ⚠ OPEN (Q-INV-4, C-4).
5. Changes run in one transaction with stock rows locked. Concurrent terminals never overwrite each other (SR-3).
6. Real-time events: `stock.changed`, `stock.low` and `stock.out`. Alerts appear when Features → Low Stock Alerts and Preferences → Low Stock Alerts are on.

Inventory changes are not available offline.

**UI today:**
- Adjustments clamp at 0 (temporary).
- There are no reserved or available columns.
- Data lives in `catalogStore`.

## 13. Admin → Choices
BUSINESS-RULES §2. Q-DEL-1 (DECIDED).

1. List choice groups ✱`choices.view`.
2. **Create / Edit** ✱`choices.manage`:
   - name, display name, description
   - single / multi, required, min / max
   - options: name, price delta ≥ 0, default, active, sort order
3. **Attach to products** from Products (§11) or from the group.
4. Edits affect new orders only. Orders keep `order_item_choices` snapshots.
5. **Delete** is allowed only if the group or option was never referenced. Otherwise **deactivate** it (Q-DEL-1).
6. Whether options consume ingredients (e.g. extra milk) is ⚠ OPEN (Q-ING-2).

**UI today:** choices are page-local and not linked to products.

## 14. Admin → Ingredients & Recipes
Q-INV-1 ★, Q-INV-2 ★, Q-INV-3 ★ (DECIDED). BUSINESS-RULES §4a. ⚑Ingredient Tracking.

1. Ingredients list ✱`ingredients.view`: on_hand, reserved, available, status, unit cost, threshold.
2. **Create / Edit** ✱`ingredients.recipes`:
   - name (unique, case-insensitive), category
   - unit from {g, kg, ml, L, pcs}
   - initial stock (an `initial` movement; decimals up to 3 places)
   - unit cost ≥ 0 (up to 4 decimal places)
   - threshold ≥ 0, notes
3. **Restock / Adjust** ✱`ingredients.adjust`. Same rules as §12: Idempotency-Key, audited, never below 0, never below reserved (409 STOCK_RESERVED), never clamped.
4. **Recipe builder** ✱`ingredients.recipes`, for products with `track_ingredients`:
   - Add ingredient lines with a quantity per serving (> 0, in the ingredient's unit). Unit conversion is ⚠ OPEN (Q-ING-4).
   - Each ingredient appears once per recipe.
   - Per-serving cost is shown. The costing method is ⚠ OPEN (Q-ING-3).
5. **Consumption:**
   - Order creation **reserves** recipe quantity × order quantity for each ingredient.
   - Completion turns the reservation into `sale` movements.
   - Cancellation releases it.
   - Recipe edits affect future orders only.
6. **Delete:** an ingredient used in any recipe or movement can only be **deactivated** (Q-DEL-1). Deactivated ingredients cannot be added to new recipe lines.

**UI today:** ingredients and recipes are page-local. Recipes are never consumed.

## 15. Admin → Expenses
BUSINESS-RULES §15. ⚑Expenses.

1. ⇢ List ✱`expenses.view`, filtered by date range, category and payment method, with totals.
2. **Record** ✱`expenses.record`:
   - category (fixed list: Supplies, Ingredients, Utilities, Rent, Equipment, Maintenance, Transportation, Marketing, Other; custom categories ⚠ OPEN Q-EXP-2)
   - description (required, ≤ 120 characters)
   - amount > 0 (2 decimal places)
   - date (not after today in business time)
   - payment method (Cash, GCash, Card, Bank Transfer, Other)
   - notes (≤ 500 characters)
   - `recorded_by` is the signed-in user; the code is `EXP-YYYY-NNN`
3. **Edit** ✱`expenses.edit`. Audited with before and after values.
4. **Void / Delete** ✱`expenses.delete`: ⚠ OPEN (Q-EXP-1). The approved principle (operational records that affect history are not hard-deleted) points to void with a reason.
5. An "Ingredients" expense does **not** restock ingredients. Restocking is done in §14.

Expenses are not available offline.

**UI today:** expenses are page-local, and "recorded by" is free text.

## 16. Admin → Archived Orders
Q-ARC-1 ★, Q-ARC-4, Q-ARC-2 ★, Q-ARC-3 (DECIDED). BUSINESS-RULES §12. **Admin only** (✱`archive.manage`, Admin-only until Q-SET-3).

**Automatic archival (completed orders)**
- A server-side scheduled job archives `completed` orders once `completed_at + archiving.auto_archive_after` has passed, in business time.
- The actor is the system. Each archive is audited and publishes `order.archived`. No user action is needed.
- Archive is a flag (`archived_at`), not a status. It **never deletes** anything.
- Restored orders are excluded from automatic re-archiving.

**Cancelled-orders review list**
- Cancelled orders are **never** auto-archived.
- The list shows cancelled orders that are not yet archived, with reason, who cancelled, when, and the released stock.
- The Admin reviews them → **Archive** with a reason.

**Manual archive** ⇢ `POST /archive` (order_ids, reason required)
- Applies to cancelled orders, or completed orders before their automatic timing.
- Only completed or cancelled orders can be archived. Audited.

**Browse** ⇢ `GET /archive`: date range, status, cashier, search. Reprinting an archived order's document keeps its number and is marked as an archived copy (§8).

**Restore** ⇢ `POST /archive/{order_id}/restore`
- Allowed within `archiving.restore_window` from `archived_at`. After that the server returns 409 RESTORE_WINDOW_EXPIRED.
- A restored completed order returns to **History**, never to the active board.
- Audited; publishes `order.restored`. Manual re-archive is allowed later.

**Retention**
- `archiving.retention_period` must be ≥ `compliance.retention_minimum`. Lower values return 422 RETENTION_BELOW_MINIMUM.
- The minimum is entered only after verification. **Until a verified minimum is configured, nothing is disposed of.**
- What happens at the end of retention is ⚠ OPEN (Q-ARC-5) ⚖ VR-6, VR-7. No legal period is stated in these documents.

The settings `auto_archive_after`, `restore_window` and `retention_period` have no screen yet (§19). Their defaults are ⚠ OPEN (Q-SET-4).

**UI today:**
- Archiving is manual only.
- The restore window is the constant `RESTORE_WINDOW_HOURS = 48` (temporary, C-10).
- Sample data comes from `archivedSampleData.ts` (dev-only).

## 17. Admin → Analytics & Overview
BUSINESS-RULES §16. ⚑Analytics.

1. ⇢ `GET /analytics/*?range=…` ✱`analytics.view` (insights ✱`analytics.insights`). With Analytics off, the server returns 403 FEATURE_DISABLED.
2. Content: KPIs, sales trend, hourly sales, channel mix (order type), payment mix (per payment method, split payments counted per method), top products, expenses, estimated profit (labelled as an estimate), and inventory health.
3. All figures come from persisted records in business time:
   - cancelled orders are excluded
   - refunds are counted on the refund date
   - offline sales are counted once committed at sync (business-day attribution, AR-5)
4. **Overview** shows today's KPIs, alerts, and recent activity. Alerts include low/out of stock, overdue orders, stale unpaid orders (AR-10) and offline transactions needing review (`sync.review_required`, §21). It updates in real time.

Not available offline.

**UI today:** `adminOverviewMockData.ts` (static) and `analyticsDemoData.ts` (opt-in demo).

## 18. Admin → Staff
Q-AUTH-2 ★ (DECIDED). BUSINESS-RULES §13, §14.

1. List staff ✱`staff.view`: search, role, status, terminal, auth method.
2. **Add** ✱`staff.add`:
   - full name, username (`^[a-z0-9._-]{3,20}$`), role
   - **authentication method**: Admin → password only; Cashier → **password or PIN**, chosen by the Admin
   - default terminal (a sign-in preference; restriction ⚠ OPEN Q-TRM-6)
   - temporary credential of the chosen type → `must_change_credential`

   Staffing limits apply (Maximum Administrators / Staff Accounts), enforced on create and reactivation. Password and PIN rules come from the one server-enforced credential policy (values ⚠ OPEN Q-AUTH-7 ★, C-1).
3. **Edit** ✱`staff.edit`. A role change needs ✱`staff.managePermissions`.
   - Last-Admin protection and "no self role change" apply.
   - Setting an Admin to PIN (or promoting a PIN Cashier to Admin without switching to password) returns 422 AUTH_METHOD_NOT_ALLOWED.
   - After switching a Cashier's method, the account needs a credential of the new type (via Reset credential).
   - Renaming a username is ⚠ OPEN (Q-AUTH-5).
4. **Reset credential** ✱`staff.resetPasswords` ⇢ `POST /staff/{id}/reset-credential`
   - Issues a temporary password or PIN, according to the account's method. It is shown once.
   - Sets `must_change_credential`. Credentials are never readable. Audited.
5. **Deactivate / Activate** ✱`staff.deactivate`
   - Deactivating ends the user's sessions immediately (`user_deactivated`) and publishes `staff.status_changed`.
   - An account with history is never deleted (Q-DEL-1).

All staff changes, role changes and permission changes are audited.

**UI today:**
- Terminal list is fixed (`REG-01…03`).
- There is no auth-method selector and no PIN.
- Passwords are validated and then discarded.
- The Staff page and Account page use two different password rule sets (C-1).

## 19. Settings (Admin)
Q-SET-1 ★, Q-RCP-1, Q-RCP-2 ★, Q-PAY-2, Q-TAX-1/2/3, Q-AUTH-4 ★, Q-ARC-2/3 (DECIDED). BUSINESS-RULES §17, §23.

**Common behaviour for every section**
- Load ⇢ `GET /settings/{section}` → edit → **Save Changes** ⇢ `PUT /settings/{section}` with `version`.
- A stale version returns 409 VERSION_CONFLICT: the page reloads and asks the Admin to redo the edits.
- A successful save is validated by the server, written to `settings_history`, audited, and publishes `settings.changed`, so other terminals apply it live.
- **Reset to Defaults** restores defaults on screen only; Save is still required. **Cancel** reverts to the last saved values.
- Each section requires its ✱`settings.<section>` permission.
- **All settings are business-wide** and apply on every terminal and for every user (Q-SET-1).
- Settings changes never rewrite issued documents or past orders (snapshots).

| Section (UI) | Configures |
|---|---|
| **Business** | Name, type, tagline, address, phone, email, currency, timezone (used for business days) |
| **Branding** | Logo, theme colours (semantic status colours cannot be overridden) |
| **Terminology** (✱`settings.terminology`, Admin-only until Q-SET-3) | Display labels only |
| **Features** | Inventory, Analytics & Insights, Expenses, **Refunds** (Q-REF-4), Discounts, Ingredient Tracking, Low Stock Alerts, Order Alerts, Live Updates, Sound Effects. Overlap with Preferences is ⚠ OPEN (Q-SET-2, C-5) |
| **Permissions** (✱`staff.managePermissions`) | Role grants. Granting a protected permission to Cashier needs confirmation and is audited |
| **Tax** | Enabled, name, **rate (configuration only — no hard-coded rate; default disabled, empty rate)**, mode included/excluded, registration number, display flags. Tax is applied after the ordinary discount. ⚖ VR-4 |
| **Payments** | Enabled methods (≥ 1) and their order. Cash: require cash received, auto change, open drawer. GCash/Card/Bank Transfer: require reference, require confirmation. `cash_rounding` { enabled, increment, mode } is a backend setting with no UI yet ⚖ VR-5 |
| **Discounts** (rows) | Create/edit/deactivate discount definitions (name, type, amount, eligibility, min order, max discount). `requires_identification` + `identification_fields` have no UI yet ⚖ VR-2, VR-7. Senior Citizen/PWD are ordinary definitions; statutory treatment is a separate compliance rule ⚖ VR-1. The per-discount "Tax Handling" control is superseded for ordinary discounts (C-12) |
| **Receipts** — **COMPLETE** | Display formatting only: **printed / digital format**; **receipt logo** (which logo prints ⚠ OPEN Q-RCP-4, C-2); **header toggles**: logo, business name, address, phone, email; **transaction-information toggles**: cashier, terminal, order number, reference, date/time, payment method, tax, discount, customer; **texts**: heading (≤ 32), thank-you (≤ 40), footer (≤ 80), small print (≤ 120). Compliance field locks override these display toggles when set (C-3 → Q-SET-2) |
| **Staffing** | Max administrators (1–10), max staff accounts (1–100), max active terminals (1–25), low-stock threshold (0–10 000), order waiting threshold (1–240 min) |
| **Preferences** (business-wide) | Interface and payment sounds, notifications, live updates and auto refresh, default order type, show order type at checkout, new-order / waiting / low-stock / payment alerts, auto-clear completed order, return to POS after payment, confirm cancel order, confirm remove cart item |

**New backend sections — no screen yet** (added in a later UI phase; ✱`settings.security` / `settings.archiving` / `settings.offline` / `settings.compliance`, Admin-only until Q-SET-3; defaults ⚠ OPEN Q-SET-4)

| Section | Keys |
|---|---|
| `security` | `idle_timeout_minutes` (§3); credential policy (Q-AUTH-7) |
| `archiving` | `auto_archive_after`, `restore_window`, `retention_period` (≥ `compliance.retention_minimum`, else 422 RETENTION_BELOW_MINIMUM) (§16) |
| `offline` | `enabled`, `sync_review_threshold`, limits (Q-TRM-7) (§20) |
| `compliance` | Document types and titles, document series (format, scope, start number, ranges, reset policy), must-print field locks, reprint marker text, `statutory_rules`, `retention_minimum`, identification display/printing policy. **Every value ⚖** (VR-1…VR-7). Kept separate from `receipts` display settings |

**Account** (every user, own record only, ✱`settings.account`; not a settings document)
- Edit full name ⇢ `PATCH /auth/me`.
- Change password (current + new + confirm) ⇢ `POST /auth/change-password`, or change PIN ⇢ `POST /auth/change-pin`, according to the account's method.
- Session info (terminal, started at).
- Log Out.

**UI today:**
- All settings stores are in-memory ("saved for this session") and nothing is enforced.
- The Overview card statuses are static.
- There are no screens for security, archiving, offline, compliance or cash rounding.

## 20. Offline operation
Q-TRM-2, Q-TRM-3, Q-TRM-4, Q-TRM-5 (DECIDED), SR-4, SR-5. BUSINESS-RULES §19. SYSTEM-LOGIC §12.

**Prerequisites**
- `offline.enabled` is on (default ⚠ OPEN Q-SET-4).
- The terminal is activated.
- The user was already signed in when the connection dropped.
- The device holds the **last synchronized snapshot** (⇢ `GET /sync/snapshot` while online). It contains catalog, pricing and settings for a `catalog_version`, plus local stock levels.

**Steps**
1. **Detect.** When requests fail or the real-time connection drops, the client switches to offline mode and shows a persistent banner ("Offline — limited mode") with the **queue indicator** (queued count and oldest item age).
2. **Allowed and unavailable actions:**

| Allowed offline | Not available offline |
|---|---|
| Continue the current session on this activated terminal | GCash / Card / Bank Transfer |
| Create orders from the last synchronized snapshot | Refunds |
| **Cash payments only** (Q-TRM-4) | Cancelling or paying orders created online |
| Local stock tracking that **blocks** sales when local available stock is insufficient | Restock / adjustments |
| Status changes on orders created offline on this terminal | Catalog, settings, staff, terminal changes |
| Print a **provisional slip** | Archive / restore · analytics · expenses · terminal activation |

To be confirmed (⚠ OPEN Q-TRM-7 ★): discounts offline (especially ID-capture discounts), new sign-in while offline, reprint offline, offline limits (duration, queued count, value), and status changes on online orders.

3. **Offline sale**
   - The cart and totals come from the snapshot. Totals are provisional; the server recomputes them at sync.
   - Payment is cash only.
   - Local stock is checked and decremented. Every local stock effect is recorded in the queued transaction.
   - The device generates a unique `client_txn_id` (UUID) and stores the transaction in persistent device storage.
   - A **provisional slip** is printed. It is **not a sales document**. Offline document numbering is ⚠ OPEN (Q-RCP-5 ★) ⚖ VR-3 (AR-2); until it is resolved, the sales document is issued only when the transaction is committed at sync.
4. **While queued**
   - Idle timeout is enforced locally (AR-3).
   - Log Out and clearing app data are blocked while unsynced items exist (AR-6).
   - The device warns when an item approaches or passes `offline.sync_review_threshold`.
5. **Reconnect and sync.** Queued transactions are sent in capture order ⇢ `POST /sync/transactions`. The device also reports its queue ⇢ `POST /sync/status`. For each transaction the server:
   - persists the raw submission (`offline_submissions`, `received`)
   - runs an idempotency check (a duplicate `client_txn_id` returns the stored outcome)
   - validates terminal, user, snapshot version, prices (recomputed from the stored `pos_snapshots`), discount, and cash-only
   - validates inventory, payment and order state under locks
   - **commits**: canonical order number, payments, stock movements, sales document, audit, events

   The client then marks the transaction **synced**, removes it from the queue, and shows the canonical order number (the sales document can now be printed). Afterwards the client refreshes the snapshot and resumes real-time events from `last_sequence`; RESYNC_REQUIRED means refetch.

| Sync outcome | Server status | Device |
|---|---|---|
| Valid, committed | `committed` | Synced; removed from queue |
| Duplicate submission | stored outcome returned | Synced (no double order) |
| Conflict (e.g. server stock insufficient, totals not reproducible, user/terminal no longer valid, non-cash) | `needs_review`; **nothing applied to stock or money**; `sync.review_required` | Shown as "Needs Admin review" (§21) |
| Not committed within `offline.sync_review_threshold` | `needs_review` | Warning; stays visible |
| Network error / no response | (attempts counted) | Stays queued; retried |

Nothing is silently lost, merged or rewritten. Server stock is never overwritten by device stock (SR-5, AR-1).

**UI today:** there is no offline detection, banner, queue indicator or provisional slip.

## 21. Offline reconciliation review
Q-TRM-5 (DECIDED), SR-4. BUSINESS-RULES §19. Admin ✱`sync.review` (Admin-only until Q-SET-3). No screen yet (later UI phase).

1. **Notice.** A `sync.review_required` event raises an alert on Admin Overview (§17) and a count badge.
2. **Review list** ⇢ `GET /sync/reviews`, filtered by status (`needs_review` / `resolved`), terminal, user and date. Each row shows:
   - `client_txn_id`, terminal, user
   - `captured_at` (device clock, not trusted, AR-5) and `received_at`
   - amount, `attempts`, `conflict_reasons`
3. **Detail** ⇢ `GET /sync/reviews/{id}` shows the original submission read-only (lines, cash payments, local stock effects, provisional slip data) next to the current server state (stock, prices) and the conflict reasons.
4. **Explicit resolution** ⇢ `POST /sync/reviews/{id}/resolve` with a resolution and a note.
   - The server applies only what the Admin explicitly chose, under the normal rules. There is no negative stock; stock corrections happen only through explicit Admin movements (§12, §14).
   - Examples: commit after an explicit stock correction, or close without committing and record how the cash was handled.
   - The set of resolution types is not yet defined; it is fixed together with ⚠ OPEN Q-TRM-7 (SYSTEM-LOGIC §12.8 records only that each resolution is an explicit, audited Admin decision).
5. The record becomes `resolved` with `resolution`, `resolved_by` / `resolved_at`, and the resulting `order_id` if an order was committed. The decision is **audited**.
6. The original submission is **never modified**.

## 22. Fresh business: from setup to first sale
SR-9. BUSINESS-RULES §18.

1. **Setup wizard** (§1): Business Setup → Create First Admin → Complete Setup → Admin signs in (requires an activated terminal; first-device activation ⚠ OPEN Q-TRM-8 ★). Nothing is seeded: no products, categories, choices, ingredients, stock, orders, documents, expenses, customers, discounts, analytics or staff.
2. **Activate terminals** (§2): register each register/device → enter its one-time code on the device. The first device is ⚠ OPEN (Q-TRM-8).
3. **Configure** (§19). Settings Overview shows which sections still need setup.
   - **Business**: review what was entered in the wizard.
   - **Tax**: disabled by default with no rate. Enable it only with verified values ⚖ VR-4.
   - **Payments**: enabled methods, references and confirmation. Cash rounding ⚖ VR-5.
   - **Receipts**: display format and texts.
   - **Compliance**: document type, title and series ⚖ VR-3. Verify before production; no screen yet.
   - **Security, archiving, offline**: defaults ⚠ OPEN (Q-SET-4); no screens yet. Retention (`archiving.retention_period`) must be ≥ a verified `compliance.retention_minimum`; nothing is disposed until one is configured ⚖ VR-6, VR-7.
   - **Features, Staffing, Preferences.**
   - **Discounts**: Senior Citizen / PWD as ordinary definitions; set `requires_identification` / `identification_fields` as determined by verification. Any statutory treatment is a separate compliance rule (`compliance.statutory_rules`, disabled by default) ⚖ VR-1, VR-2, VR-7.
4. **Catalog**: categories → products (`tax_class`, `track_units` / `track_ingredients`) (§11) → choices (§13) → ingredients and recipes (§14).
5. **Stock**: initial stock and restocks (§12, §14).
6. **Staff**: cashier accounts with password or PIN (§18).
7. **POS readiness.** POS shows an empty state until there is **at least one active, available product and at least one enabled payment method**. The empty state points to Admin → Products or Settings → Payments.
8. **First sale**: create order (§4) → Orders board (§5) → payment and sales document (§6) → complete (§7).

**UI today:**
- Settings Overview statuses are static.
- POS, Orders, Receipts, History and Overview show demo data until the integration phase (SR-10). This demo data must never be written to a production database.
