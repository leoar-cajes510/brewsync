import { useEffect, useState } from 'react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import type { DiscountDto } from '../../types/api';

const LABELS: Record<string, string> = { customer_name: 'Customer Name', id_type: 'ID Type', id_number: 'ID Number' };

interface IdentificationDialogProps {
  discount: DiscountDto | null;
  onCancel: () => void;
  onConfirm: (discount: DiscountDto, identification: Record<string, string>) => void;
}

// Discounts set to require identification (Q-DSC-3): the cashier records exactly the fields the
// discount asks for. The server stores them on the order (ID number masked in lists, never in events).
export default function IdentificationDialog({ discount, onCancel, onConfirm }: IdentificationDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    setValues({});
    setSubmitted(false);
  }, [discount]);
  if (!discount) return null;
  const fields = discount.identification_fields.length ? discount.identification_fields : ['customer_name', 'id_type', 'id_number'];
  const missing = fields.filter((f) => !values[f]?.trim());

  const confirm = () => {
    setSubmitted(true);
    if (missing.length) return;
    onConfirm(discount, Object.fromEntries(fields.map((f) => [f, values[f].trim()])));
  };

  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      title={`${discount.name}: customer identification`}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={confirm}>
            Apply Discount
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
      >
        <p className="text-muted">This discount requires the customer's identification details.</p>
        {fields.map((f, i) => (
          <Input
            key={f}
            label={LABELS[f] ?? f}
            value={values[f] ?? ''}
            maxLength={80}
            autoFocus={i === 0}
            autoComplete="off"
            onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
            error={submitted && !values[f]?.trim() ? `Enter the ${(LABELS[f] ?? f).toLowerCase()}.` : undefined}
          />
        ))}
      </form>
    </Modal>
  );
}
