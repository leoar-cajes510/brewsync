import { Minus, Plus, X } from 'lucide-react';
import type { CartLine } from '../../types/order';
import { formatPeso } from '../../utils/currency';

interface CartItemProps {
  line: CartLine;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
}

export default function CartItem({ line, onIncrement, onDecrement, onRemove }: CartItemProps) {
  return (
    <div className="cart-item">
      <div className="cart-item__head">
        <div className="cart-item__titles">
          <span className="cart-item__name">{line.name}</span>
          <span className="cart-item__unit">{formatPeso(line.unitPrice)} ea</span>
        </div>
        <button type="button" className="cart-item__remove" onClick={onRemove} aria-label={`Remove ${line.name}`}>
          <X size={16} />
        </button>
      </div>

      {line.choices.length > 0 && (
        <div className="cart-item__choices">
          {line.choices.map((c) => (
            <span key={c.id} className="chip">
              {c.label}
              {c.priceDelta > 0 && ` (+${formatPeso(c.priceDelta).replace('.00', '')})`}
            </span>
          ))}
        </div>
      )}

      <div className="cart-item__foot">
        <div className="stepper">
          <button type="button" onClick={onDecrement} aria-label="Decrease quantity">
            <Minus size={14} />
          </button>
          <span className="stepper__value">{line.quantity}</span>
          <button type="button" onClick={onIncrement} aria-label="Increase quantity">
            <Plus size={14} />
          </button>
        </div>
        <span className="cart-item__total">{formatPeso(line.unitPrice * line.quantity)}</span>
      </div>
    </div>
  );
}
