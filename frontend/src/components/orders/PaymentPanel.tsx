import { useState } from 'react';
import { Banknote, CheckCircle2, CreditCard, Landmark, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import PaymentSelector, { paymentLabel } from '../pos/PaymentSelector';
import type { OrderPayment } from '../../types/order';
import type { PaymentMethod } from '../../types/payment';
import { formatPeso } from '../../utils/currency';

const methodIcons: Record<PaymentMethod, LucideIcon> = {
  cash: Banknote,
  gcash: Smartphone,
  card: CreditCard,
  'bank-transfer': Landmark,
};

interface PaymentPanelProps {
  payment: OrderPayment;
  total: number;
  /** Server amounts: paid so far and remaining balance (split payments). */
  paid?: number;
  due?: number;
  collecting: boolean;
  onStartCollect: () => void;
  onCancel: () => void;
  /** Inline collect form (unused by the Orders page, which records payments through CheckoutModal → POST /orders/{id}/payments). */
  onPay: (payment: OrderPayment) => void;
}

export default function PaymentPanel({ payment, total, paid = 0, due, collecting, onStartCollect, onCancel, onPay }: PaymentPanelProps) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');

  if (payment.status === 'paid' && payment.method) {
    const Icon = methodIcons[payment.method];
    return (
      <div className="payment-panel payment-panel--paid">
        <span className="payment-panel__icon">
          <Icon size={16} />
        </span>
        <div className="payment-panel__info">
          <strong>{paymentLabel(payment.method)}</strong>
          <span>{payment.reference ? `Ref #${payment.reference}` : 'Paid in full'}</span>
        </div>
        <Badge tone="success">
          <CheckCircle2 size={12} /> Paid
        </Badge>
      </div>
    );
  }

  if (!collecting) {
    return (
      <div className="payment-panel">
        <div className="payment-panel__info">
          <strong>Payment</strong>
          <span>{paid > 0 && due !== undefined ? `${formatPeso(paid)} paid · ${formatPeso(due)} due` : 'Not yet collected'}</span>
        </div>
        <Badge tone="warning" dot>
          {paid > 0 ? 'Partially Paid' : 'Awaiting Payment'}
        </Badge>
        <Button size="sm" variant="primary" onClick={onStartCollect}>
          Collect
        </Button>
      </div>
    );
  }

  const tenderedAmount = Number(tendered) || 0;
  const canConfirm = method === 'cash' ? tenderedAmount >= total : reference.trim().length > 0;

  return (
    <div className="payment-panel payment-panel--collect">
      <div className="payment-panel__collect-head">
        <strong>Collect Payment</strong>
        <span>{formatPeso(total)}</span>
      </div>
      <PaymentSelector value={method} onChange={setMethod} />
      {method === 'cash' ? (
        <>
          <Input
            label="Amount Tendered"
            type="number"
            min={0}
            inputMode="decimal"
            placeholder="0.00"
            value={tendered}
            onChange={(e) => setTendered(e.target.value)}
          />
          <div className="payment-panel__change">
            <span>Change</span>
            <strong>{formatPeso(Math.max(tenderedAmount - total, 0))}</strong>
          </div>
        </>
      ) : (
        <Input
          label={`${paymentLabel(method)} Reference No.`}
          placeholder="Enter reference number"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      )}
      <div className="payment-panel__actions">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!canConfirm}
          onClick={() => onPay({ status: 'paid', method, reference: method === 'cash' ? undefined : reference.trim() })}
        >
          Confirm Payment
        </Button>
      </div>
    </div>
  );
}
