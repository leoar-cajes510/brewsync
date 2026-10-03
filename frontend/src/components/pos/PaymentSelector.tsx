import { useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Banknote, CreditCard, Landmark, Smartphone } from 'lucide-react';
import type { PaymentMethod } from '../../types/payment';
import { enabledMethods, usePaymentSettings, type PaymentMethodKey } from '../../stores/paymentSettingsStore';

const SETTINGS_KEY: Record<PaymentMethod, PaymentMethodKey> = { cash: 'cash', gcash: 'gcash', card: 'card', 'bank-transfer': 'bank' };

const methods: { id: PaymentMethod; label: string; hint: string; icon: LucideIcon }[] = [
  { id: 'cash', label: 'Cash', hint: 'Bills & coins', icon: Banknote },
  { id: 'gcash', label: 'GCash', hint: 'QR / e-wallet', icon: Smartphone },
  { id: 'card', label: 'Card', hint: 'Debit / credit', icon: CreditCard },
  { id: 'bank-transfer', label: 'Bank Transfer', hint: 'InstaPay / PESONet', icon: Landmark },
];

export function paymentLabel(id: PaymentMethod): string {
  return methods.find((m) => m.id === id)?.label ?? id;
}

interface PaymentSelectorProps {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
}

// Only the methods enabled in Settings → Payments, in the configured order. The server still
// rejects a disabled method (METHOD_NOT_ENABLED); until settings load, all methods are shown.
export default function PaymentSelector({ value, onChange }: PaymentSelectorProps) {
  const { settings, loaded, configured } = usePaymentSettings();
  const offered =
    loaded && configured
      ? enabledMethods(settings).flatMap((key) => methods.filter((m) => SETTINGS_KEY[m.id] === key))
      : methods;
  const first = offered[0]?.id;
  useEffect(() => {
    if (first && !offered.some((m) => m.id === value)) onChange(first);
  }, [first, value, offered, onChange]);

  if (offered.length === 0) return <p className="text-muted">No payment methods are enabled. An Admin can enable them in Settings → Payments.</p>;

  return (
    <div className="payment-selector" role="radiogroup" aria-label="Payment method">
      {offered.map(({ id, label, hint, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          className={`payment-method ${value === id ? 'payment-method--active' : ''}`}
          onClick={() => onChange(id)}
        >
          <Icon size={22} />
          <strong>{label}</strong>
          <span>{hint}</span>
        </button>
      ))}
    </div>
  );
}
