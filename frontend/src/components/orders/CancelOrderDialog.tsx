import { useEffect, useState } from 'react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import { errorMessage } from '../../services/api';
import type { Order } from '../../types/order';

interface CancelOrderDialogProps {
  order: Order | null;
  onClose: () => void;
  /** POST /orders/{id}/cancel; rejects with the server error, shown inline. */
  onCancel: (order: Order, reason: string) => Promise<void>;
}

const MAX_REASON = 200;

export default function CancelOrderDialog({ order, onClose, onCancel }: CancelOrderDialogProps) {
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    setReason('');
    setSubmitted(false);
    setServerError(null);
  }, [order]);

  if (!order) return null;

  const reasonError = !reason.trim() ? 'Enter a reason for cancelling.' : undefined;

  const submit = async () => {
    setSubmitted(true);
    if (reasonError || saving) return;
    setSaving(true);
    setServerError(null);
    try {
      await onCancel(order, reason.trim());
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
      title={`Cancel Order #${order.number}?`}
      footer={
        <>
          <Button onClick={onClose}>Keep Order</Button>
          <Button variant="danger" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Cancelling…' : 'Cancel Order'}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="text-muted">The order is removed from the board and its reserved stock is released.</p>
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
