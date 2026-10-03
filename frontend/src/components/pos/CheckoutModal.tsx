import { useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import PaymentSelector, { paymentLabel } from './PaymentSelector';
import type { PaymentMethod } from '../../types/payment';
import type { OrderDto, PaymentResultDto } from '../../types/api';
import { errorMessage, newIdempotencyKey } from '../../services/api';
import { recordPayment } from '../../services/paymentService';
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

// Records payments through POST /orders/{id}/payments. The amount is a request: the server
// validates it against the remaining balance (OVERPAYMENT), computes change/rounding, and
// issues the sales document when the order becomes fully paid. Split payments = several
// payments on the same order.
function CheckoutBody({ order: initial, onClose, onPaid }: Omit<CheckoutModalProps, 'order'> & { order: OrderDto }) {
  const [order, setOrder] = useState(initial);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState(initial.amount_due);
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PaymentResultDto | null>(null);
  // One key per payment attempt: a retry of the same request is replayed, never duplicated.
  const attemptKey = useRef<string | null>(null);

  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    attemptKey.current = null;
    setter(v);
  };

  const due = Number(order.amount_due);
  const amountValue = Number(amount);
  const tenderedValue = Number(tendered);
  const validAmount = amount.trim() !== '' && Number.isFinite(amountValue) && amountValue > 0;
  const canConfirm = validAmount && (method !== 'cash' || tendered.trim() === '' || tenderedValue >= amountValue);

  const submit = async () => {
    if (!canConfirm || submitting) return;
    attemptKey.current ??= newIdempotencyKey();
    setSubmitting(true);
    setError(null);
    try {
      const paid = await recordPayment(
        order.id,
        {
          method: toApiMethod(method),
          amount: amountValue.toFixed(2),
          ...(method === 'cash' && tendered.trim() ? { tendered: tenderedValue.toFixed(2) } : {}),
          ...(method !== 'cash' && reference.trim() ? { reference: reference.trim() } : {}),
        },
        attemptKey.current,
      );
      attemptKey.current = null;
      setOrder(paid);
      onPaid(paid);
      setResult(paid);
      setAmount(paid.amount_due);
      setTendered('');
      setReference('');
    } catch (err) {
      setError(errorMessage(err));
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
          <Button variant="primary" disabled={!canConfirm || submitting} onClick={() => void submit()}>
            {submitting ? 'Recording…' : `Record Payment · ${validAmount ? formatPeso(amountValue) : '—'}`}
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
