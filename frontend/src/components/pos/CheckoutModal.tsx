import { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import PaymentSelector, { paymentLabel } from './PaymentSelector';
import type { PaymentMethod } from '../../types/payment';
import type { OrderDto, PaymentResultDto } from '../../types/api';
import { errorMessage, isUnknownOutcome, newIdempotencyKey } from '../../services/api';
import { recordPayment, type PaymentInput } from '../../services/paymentService';
import { getOrder } from '../../services/orderService';
import { currentUserId as getAuthUserId } from '../../stores/authStore';
import { notify } from '../../stores/notificationStore';
import { useFeatureSettings } from '../../stores/featureSettingsStore';
import { usePreferenceSettings } from '../../stores/preferenceSettingsStore';
import { alertGates } from '../../utils/liveAlerts';
import { playSound } from '../../utils/sound';
import { toApiMethod } from '../../utils/apiMappers';
import { formatPeso } from '../../utils/currency';

interface CheckoutModalProps {
  /** The placed order to collect payment for (order-first / pay-later). */
  order: OrderDto | null;
  onClose: () => void;
  /** Called with the latest server state after each recorded payment. */
  onPaid: (order: OrderDto) => void;
}

const QUICK_CASH = [100, 200, 500, 1000];

/** A payment whose outcome is unknown survives closing the dialog or reloading the page, so it is
 *  always resolved with the SAME key and payload (the server replays it) — never charged twice. */
interface PendingPayment {
  key: string;
  input: PaymentInput;
}
// Keyed by user + order: after a lock/sign-out another cashier never inherits (or replays) it.
const pendingKey = (orderId: string) => `brewsync.pendingPayment.${currentUserId()}.${orderId}`;
const currentUserId = () => getAuthUserId() ?? 'anonymous';
function loadPendingPayment(orderId: string): PendingPayment | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(orderId));
    return raw ? (JSON.parse(raw) as PendingPayment) : null;
  } catch {
    return null;
  }
}
function savePendingPayment(orderId: string, value: PendingPayment | null) {
  try {
    if (value) sessionStorage.setItem(pendingKey(orderId), JSON.stringify(value));
    else sessionStorage.removeItem(pendingKey(orderId));
  } catch {
    /* storage unavailable */
  }
}

// Records payments through POST /orders/{id}/payments. The amount is a request: the server
// validates it against the remaining balance (OVERPAYMENT), computes change/rounding, and
// issues the sales document when the order becomes fully paid. Split payments = several
// payments on the same order.
function CheckoutBody({ order: initial, onClose, onPaid }: Omit<CheckoutModalProps, 'order'> & { order: OrderDto }) {
  const [order, setOrder] = useState(initial);
  const { flags } = useFeatureSettings();
  const { settings: prefs } = usePreferenceSettings();
  const gates = alertGates(flags, prefs);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState(initial.amount_due);
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    loadPendingPayment(initial.id)
      ? 'An earlier payment on this order got no answer from the server. Press Confirm to check it; it will not be charged twice.'
      : null,
  );
  const [result, setResult] = useState<PaymentResultDto | null>(null);
  // One key per payment attempt: a retry of the same request is replayed, never duplicated.
  const restored = useRef(loadPendingPayment(initial.id));
  const attemptKey = useRef<string | null>(restored.current?.key ?? null);
  // After a timeout the payment may already be recorded: the form is frozen and the next press
  // re-sends the identical request with the same key (replayed by the server, never doubled).
  const lastInput = useRef<PaymentInput | null>(restored.current?.input ?? null);
  const [uncertain, setUncertain] = useState(restored.current !== null);

  // The order passed in may be stale (another terminal paid, an earlier attempt succeeded):
  // always start from the server's current balance and payments.
  useEffect(() => {
    let cancelled = false;
    getOrder(initial.id)
      .then((fresh) => {
        if (cancelled) return;
        setOrder(fresh);
        if (!restored.current) setAmount(fresh.amount_due);
      })
      .catch(() => {
        /* keep the given order; the server still validates every payment */
      });
    return () => {
      cancelled = true;
    };
  }, [initial.id]);

  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    if (uncertain) return;
    attemptKey.current = null;
    setter(v);
  };

  const due = Number(order.amount_due);
  const amountValue = Number(amount);
  const tenderedValue = Number(tendered);
  const validAmount = amount.trim() !== '' && Number.isFinite(amountValue) && amountValue > 0;
  const canConfirm = (uncertain && lastInput.current !== null) || (validAmount && (method !== 'cash' || tendered.trim() === '' || tenderedValue >= amountValue));

  const submit = async () => {
    if (!canConfirm || submitting) return;
    attemptKey.current ??= newIdempotencyKey();
    setSubmitting(true);
    setError(null);
    const input: PaymentInput = uncertain && lastInput.current ? lastInput.current : {
      method: toApiMethod(method),
      amount: amountValue.toFixed(2),
      ...(method === 'cash' && tendered.trim() ? { tendered: tenderedValue.toFixed(2) } : {}),
      ...(method !== 'cash' && reference.trim() ? { reference: reference.trim() } : {}),
    };
    lastInput.current = input;
    try {
      const paid = await recordPayment(order.id, input, attemptKey.current);
      attemptKey.current = null;
      lastInput.current = null;
      savePendingPayment(order.id, null);
      setUncertain(false);
      if (gates.paymentSound) playSound('success');
      if (gates.payments)
        notify({ tone: 'success', title: `Payment recorded · #${paid.number}`,
                 message: paid.payment_status === 'paid' ? 'Paid in full' : `Remaining ${formatPeso(Number(paid.amount_due))}` }, 4000);
      setOrder(paid);
      onPaid(paid);
      setResult(paid);
      setAmount(paid.amount_due);
      setTendered('');
      setReference('');
    } catch (err) {
      if (isUnknownOutcome(err)) {
        savePendingPayment(order.id, { key: attemptKey.current!, input });
        setUncertain(true);
        setError('No answer from the server — this payment may already be recorded. Press Confirm again to check; it will not be charged twice.');
      } else {
        attemptKey.current = null;
        lastInput.current = null;
        savePendingPayment(order.id, null);
        setUncertain(false);
        setError(errorMessage(err));
        if (gates.paymentSound) playSound('error');
        if (gates.payments) notify({ tone: 'danger', title: `Payment not recorded · #${order.number}`, message: errorMessage(err) }, 6000);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (result && result.payment_status === 'paid') {
    return (
      <Modal
        open
        onClose={onClose}
        title={`Order #${order.number}`}
        size="sm"
        footer={
          <Button variant="primary" block onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="checkout-done">
          <CheckCircle2 size={44} />
          <strong>Paid in full</strong>
          <span>
            {formatPeso(Number(order.totals.total))}
            {result.payment.change_given && Number(result.payment.change_given) > 0 && ` · Change ${formatPeso(Number(result.payment.change_given))}`}
          </span>
          {result.document && <span>Receipt #{result.document.number} issued</span>}
          <span className="text-muted">The order stays on the Orders board until it is completed.</span>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Collect Payment · Order #${order.number}`}
      size="md"
      footer={
        <>
          <Button onClick={onClose} disabled={submitting}>
            Pay Later
          </Button>
          {uncertain && (
            <Button
              disabled={submitting}
              title="Reload the order from the server and start this payment again"
              onClick={() => {
                // Safe: the fresh balance below already includes the earlier payment if it was
                // recorded, and the server refuses any payment above the remaining balance.
                savePendingPayment(order.id, null);
                attemptKey.current = null;
                lastInput.current = null;
                setUncertain(false);
                setError(null);
                void getOrder(order.id).then((fresh) => {
                  setOrder(fresh);
                  setAmount(fresh.amount_due);
                });
              }}
            >
              Discard &amp; reload
            </Button>
          )}
          <Button variant="primary" disabled={!canConfirm || submitting} onClick={() => void submit()}>
            {submitting
              ? 'Recording…'
              : uncertain && lastInput.current
                ? `Check payment · ${formatPeso(Number(lastInput.current.amount))}`
                : `Record Payment · ${validAmount ? formatPeso(amountValue) : '—'}`}
          </Button>
        </>
      }
    >
      <div className="checkout">
        <div className="checkout__due">
          <span>{order.payment_status === 'partially_paid' ? 'Remaining Balance' : 'Total Due'}</span>
          <strong>{formatPeso(due)}</strong>
        </div>
        {result && (
          <div className="api-status api-status--info" role="status">
            Payment recorded ({paymentLabel(method)}). Remaining balance: {formatPeso(Number(result.amount_due))}.
          </div>
        )}

        <PaymentSelector value={method} onChange={touch(setMethod)} />

        <Input
          label="Amount (split payments allowed)"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={amount}
          onChange={(e) => touch(setAmount)(e.target.value)}
        />

        {method === 'cash' ? (
          <div className="checkout__cash">
            <Input
              label="Amount Tendered"
              type="number"
              min={0}
              inputMode="decimal"
              placeholder="0.00"
              value={tendered}
              onChange={(e) => touch(setTendered)(e.target.value)}
            />
            <div className="checkout__quick">
              <Button size="sm" onClick={() => touch(setTendered)(validAmount ? amountValue.toFixed(2) : '')}>
                Exact
              </Button>
              {QUICK_CASH.map((q) => (
                <Button key={q} size="sm" onClick={() => touch(setTendered)(String(q))}>
                  {formatPeso(q).replace('.00', '')}
                </Button>
              ))}
            </div>
            <div className="summary-row summary-row--strong">
              <span>Change (computed by the server)</span>
              <span>{tendered && validAmount ? `≈ ${formatPeso(Math.max(tenderedValue - amountValue, 0))}` : '—'}</span>
            </div>
          </div>
        ) : (
          <Input
            label={`${paymentLabel(method)} Reference No.`}
            placeholder="Enter reference number"
            value={reference}
            onChange={(e) => touch(setReference)(e.target.value)}
          />
        )}

        {error && (
          <div className="api-status api-status--error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function CheckoutModal({ order, ...rest }: CheckoutModalProps) {
  if (!order) return null;
  return <CheckoutBody key={order.id} order={order} {...rest} />;
}
