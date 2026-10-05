import { useEffect, useState } from 'react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import { errorMessage, newIdempotencyKey } from '../../services/api';
import type { Transaction } from '../../types/receipt';
import { formatPeso } from '../../utils/currency';

interface RefundDialogProps {
  transaction: Transaction | null;
  /** Amount still refundable (completed payments minus earlier refunds). */
  amount: number;
  onClose: () => void;
  /** POST /orders/{id}/refunds; rejects with the server error, shown inline. */
  onRefund: (t: Transaction, reason: string, idempotencyKey: string, amount?: string) => Promise<void>;
}

const MAX_REASON = 200;

export default function RefundDialog({ transaction: t, amount, onClose, onRefund }: RefundDialogProps) {
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [partial, setPartial] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // One key per dialog: retrying after a network error cannot record a second refund.
  const [key, setKey] = useState(newIdempotencyKey);

  useEffect(() => {
    setReason('');
    setMode('full');
    setPartial('');
    setSubmitted(false);
    setServerError(null);
    setKey(newIdempotencyKey());
  }, [t]);

  if (!t) return null;

  const reasonError = !reason.trim() ? 'Enter a reason for the refund.' : undefined;
  const partialValue = Number(partial);
  const amountError =
    mode !== 'partial'
      ? undefined
      : !/^\d+(\.\d{1,2})?$/.test(partial.trim()) || partialValue <= 0
        ? 'Enter an amount greater than 0 with at most 2 decimals.'
        : partialValue > amount + 1e-9
          ? `At most ${formatPeso(amount)} can be refunded.`
          : undefined;
  const refundAmount = mode === 'partial' && !amountError ? partialValue : amount;
  // A different request needs a different key; the same request keeps it (safe retry).
  const change = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setKey(newIdempotencyKey());
  };

  const submit = async () => {
    setSubmitted(true);
    if (reasonError || amountError || saving) return;
    setSaving(true);
    setServerError(null);
    try {
      await onRefund(t, reason.trim(), key, mode === 'partial' ? partialValue.toFixed(2) : undefined);
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Refund Transaction #${t.orderNumber}?`}
      footer={
        <>
          <Button onClick={onClose}>Keep Transaction</Button>
          <Button variant="danger" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Refunding…' : `Refund ${formatPeso(refundAmount)}`}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="segmented" role="radiogroup" aria-label="Refund type" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Button size="sm" variant={mode === 'full' ? 'primary' : undefined} aria-pressed={mode === 'full'} onClick={() => change(setMode)('full')}>
            Full · {formatPeso(amount)}
          </Button>
          <Button size="sm" variant={mode === 'partial' ? 'primary' : undefined} aria-pressed={mode === 'partial'} onClick={() => change(setMode)('partial')}>
            Partial amount
          </Button>
        </div>
        <p className="text-muted">
          {mode === 'full'
            ? `A full refund of ${formatPeso(amount)} is recorded against the original payment(s).`
            : 'A partial refund is returned against the most recent payment first.'}{' '}
          The order and receipt are kept; nothing is returned to stock.
        </p>
        {mode === 'partial' && (
          <Input
            label="Amount to refund"
            inputMode="decimal"
            value={partial}
            onChange={(e) => change(setPartial)(e.target.value)}
            error={submitted ? amountError : undefined}
          />
        )}
        <Input
          label="Reason"
          value={reason}
          maxLength={MAX_REASON}
          autoFocus
          onChange={(e) => setReason(e.target.value)}
          error={submitted ? reasonError : undefined}
        />
        {serverError && (
          <div className="api-status api-status--error" role="alert">
            {serverError}
          </div>
        )}
      </form>
    </Modal>
  );
}
