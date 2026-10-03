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
  onRefund: (t: Transaction, reason: string, idempotencyKey: string) => Promise<void>;
}

const MAX_REASON = 200;

export default function RefundDialog({ transaction: t, amount, onClose, onRefund }: RefundDialogProps) {
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // One key per dialog: retrying after a network error cannot record a second refund.
  const [key, setKey] = useState(newIdempotencyKey);

  useEffect(() => {
    setReason('');
    setSubmitted(false);
    setServerError(null);
    setKey(newIdempotencyKey());
  }, [t]);

  if (!t) return null;

  const reasonError = !reason.trim() ? 'Enter a reason for the refund.' : undefined;

  const submit = async () => {
    setSubmitted(true);
    if (reasonError || saving) return;
    setSaving(true);
    setServerError(null);
    try {
      await onRefund(t, reason.trim(), key);
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
            {saving ? 'Refunding…' : `Refund ${formatPeso(amount)}`}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="text-muted">
          A full refund of {formatPeso(amount)} is recorded against the original payment(s). The order and receipt are kept and marked refunded.
        </p>
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
