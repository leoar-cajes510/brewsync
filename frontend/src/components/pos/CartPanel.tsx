import { Banknote, ListX, PauseCircle, ShoppingBag, Split, Tag, User, X } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import Tabs from '../ui/Tabs';
import CartItem from './CartItem';
import type { CartLine, OrderType } from '../../types/order';
import { formatPeso } from '../../utils/currency';

export interface CartTotals {
  itemCount: number;
  quantity: number;
  subtotal: number;
  discount: number;
  /** Tax from the server quote (Settings → Tax); 0 when tax is disabled. */
  vat: number;
  total: number;
}

interface CartPanelProps {
  orderNumber: string;
  orderType: OrderType;
  onOrderTypeChange: (type: OrderType) => void;
  /** Preferences → Show Order Type Selection During Checkout; when off the default type applies. */
  showOrderType?: boolean;
  /** Settings → Features → Discounts; when off no discount can be added. */
  discountsEnabled?: boolean;
  lines: CartLine[];
  totals: CartTotals;
  discountLabel: string | null;
  /** Server quote state: totals shown are the server's, never computed here. */
  pricing?: 'idle' | 'loading' | 'ready' | 'error';
  submitting?: boolean;
  error?: string | null;
  onIncrement: (key: string) => void;
  onDecrement: (key: string) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onOpenDiscount: () => void;
  onClearDiscount: () => void;
  onCharge: () => void;
  /** The server says the cart cannot be made now (stock/recipe); Place Order is disabled. */
  blocked?: boolean;
  /** Replaces the Place Order label (e.g. "Check order" while a submission is unresolved). */
  chargeLabel?: string;
}

const orderTypes = [
  { value: 'dine-in', label: 'Dine-In' },
  { value: 'takeout', label: 'Takeout' },
  { value: 'delivery', label: 'Delivery' },
];

export default function CartPanel({
  orderNumber,
  orderType,
  onOrderTypeChange,
  showOrderType = true,
  discountsEnabled = true,
  lines,
  totals,
  discountLabel,
  pricing = 'ready',
  submitting = false,
  error = null,
  onIncrement,
  onDecrement,
  onRemove,
  onClear,
  onOpenDiscount,
  onClearDiscount,
  onCharge,
  blocked = false,
  chargeLabel,
}: CartPanelProps) {
  const empty = lines.length === 0;

  return (
    <aside className="cart-panel" aria-label="Current order">
      <div className="cart-panel__header">
        <div className="cart-panel__title-row">
          <h2 className="cart-panel__title">Order #{orderNumber}</h2>
          <Badge tone="success" dot>
            Active
          </Badge>
          <button type="button" className="icon-btn cart-panel__clear" onClick={onClear} disabled={empty} title="Clear order" aria-label="Clear order">
            <ListX size={16} />
          </button>
        </div>
        {showOrderType && (
          <div className="cart-panel__type">
            <Tabs items={orderTypes} value={orderType} onChange={(v) => onOrderTypeChange(v as OrderType)} />
          </div>
        )}
        <div className="cart-panel__customer">
          <User size={15} />
          <span>Customer: Walk-in</span>
        </div>
      </div>

      <div className="cart-panel__items">
        {empty ? (
          <EmptyState icon={<ShoppingBag size={22} />} title="No items yet" description="Tap a product to add it to this order." />
        ) : (
          lines.map((line) => (
            <CartItem
              key={line.key}
              line={line}
              onIncrement={() => onIncrement(line.key)}
              onDecrement={() => onDecrement(line.key)}
              onRemove={() => onRemove(line.key)}
            />
          ))
        )}
      </div>

      <div className="cart-panel__summary">
        <div className="summary-row">
          <span>
            Items Subtotal ({totals.itemCount} {totals.itemCount === 1 ? 'item' : 'items'}, {totals.quantity} qty)
          </span>
          <span>{formatPeso(totals.subtotal)}</span>
        </div>
        <div className="summary-row">
          <span>Tax</span>
          <span>{formatPeso(totals.vat)}</span>
        </div>
        <div className="summary-row">
          {discountLabel ? (
            <span className="summary-row__discount">
              Discount ({discountLabel})
              <button type="button" onClick={onClearDiscount} aria-label="Remove discount">
                <X size={12} />
              </button>
            </span>
          ) : discountsEnabled ? (
            <button type="button" className="link-btn" onClick={onOpenDiscount} disabled={empty}>
              <Tag size={13} /> Add Discount
            </button>
          ) : (
            <span>Discount</span>
          )}
          <span className="summary-row__success">
            {totals.discount > 0 ? `−${formatPeso(totals.discount)}` : formatPeso(0)}
          </span>
        </div>

        <div className="cart-panel__due">
          <div>
            <span className={`cart-panel__ready ${empty ? 'cart-panel__ready--idle' : ''}`}>
              <span className="status-dot" /> {empty ? 'Awaiting Items' : pricing === 'loading' ? 'Calculating…' : pricing === 'error' ? 'Totals unavailable' : blocked ? 'Unavailable' : 'Ready to Place'}
            </span>
            <span className="cart-panel__due-label">Total Due</span>
          </div>
          <span className="cart-panel__due-amount">{formatPeso(totals.total)}</span>
        </div>

        {error && (
          <div className="api-status api-status--error" role="alert">
            {error}
          </div>
        )}
        <Button
          variant="primary"
          size="lg"
          block
          icon={<Banknote size={20} />}
          disabled={chargeLabel ? submitting : empty || submitting || pricing !== 'ready' || blocked}
          onClick={onCharge}
        >
          {submitting ? (chargeLabel ? 'Checking…' : 'Placing Order…') : chargeLabel ?? `Place Order · ${formatPeso(totals.total)}`}
        </Button>
        <div className="cart-panel__secondary">
          <Button icon={<Split size={15} />} disabled title="Available in a later phase">
            Split Bill
          </Button>
          <Button icon={<PauseCircle size={15} />} disabled title="Available in a later phase">
            Hold Order
          </Button>
        </div>
      </div>
    </aside>
  );
}
