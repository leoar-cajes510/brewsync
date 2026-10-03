import { Check, CheckCircle2, Clock, Timer } from 'lucide-react';
import Button from '../ui/Button';
import type { Order } from '../../types/order';
import { formatPeso } from '../../utils/currency';
import { formatTime, minutesSince, orderTotals, orderTypeLabel } from '../../utils/orderDisplay';

const SLOW_PREP_MINUTES = 10;

interface OrderCardProps {
  order: Order;
  now: Date;
  selected: boolean;
  onSelect: (order: Order) => void;
  onAdvance: (order: Order) => void;
}

function TimeMeta({ order, now }: { order: Order; now: Date }) {
  if (order.status === 'ready' && order.readyAt) {
    return (
      <span className="order-card__time order-card__time--ready">
        <CheckCircle2 size={13} /> Ready {minutesSince(order.readyAt, now)}m
      </span>
    );
  }
  if (order.status === 'preparing') {
    const elapsed = minutesSince(order.startedAt ?? order.placedAt, now);
    const slow = elapsed >= SLOW_PREP_MINUTES;
    return (
      <span className="order-card__time-stack">
        <span className={`order-card__time ${slow ? 'order-card__time--late' : ''}`}>
          <Timer size={13} /> {elapsed}m elapsed
        </span>
        <span className="order-card__clock">{formatTime(order.placedAt)}</span>
      </span>
    );
  }
  const waited = minutesSince(order.placedAt, now);
  if (waited < 1) return <span className="order-card__time order-card__time--late">Just now</span>;
  return (
    <span className="order-card__time">
      <Clock size={13} /> {waited}m ago
    </span>
  );
}

function ActionButton({ order, selected, onAdvance }: { order: Order; selected: boolean; onAdvance: () => void }) {
  if (order.status === 'pending') {
    return (
      <Button size="sm" onClick={onAdvance}>
        Start Preparing
      </Button>
    );
  }
  if (order.status === 'preparing') {
    return (
      <Button size="sm" variant={selected ? 'primary' : 'secondary'} icon={selected ? <Check size={14} /> : undefined} onClick={onAdvance}>
        Mark Ready
      </Button>
    );
  }
  return (
    <Button size="sm" variant="success" onClick={onAdvance}>
      {order.payment.status === 'paid' ? 'Complete' : 'Collect Payment'}
    </Button>
  );
}

export default function OrderCard({ order, now, selected, onSelect, onAdvance }: OrderCardProps) {
  const totals = orderTotals(order);
  const hasChoices = order.items.some((i) => i.choices.length > 0);
  const summary = order.items.map((i) => `${i.quantity} × ${i.name}`).join(', ');
  const qtyLabel = `${totals.quantity} ${totals.quantity === 1 ? 'item' : 'items'}`;

  return (
    <article
      className={`order-card ${selected ? 'order-card--selected' : ''}`}
      onClick={() => onSelect(order)}
      aria-current={selected}
    >
      <div className="order-card__head">
        <div className="order-card__id">
          <span className="order-card__number">#{order.number}</span>
          <span className={`order-type order-type--${order.type}`}>{orderTypeLabel(order)}</span>
        </div>
        <TimeMeta order={order} now={now} />
      </div>

      <div className="order-card__customer">
        {order.customer}
        {order.payment.status === 'paid' ? (
          <CheckCircle2 size={14} className="order-card__paid" aria-label="Paid" />
        ) : (
          <span className="order-card__unpaid">Unpaid</span>
        )}
      </div>

      <div className="order-card__items">
        <p>{summary}</p>
        <span className={hasChoices ? 'order-card__mods' : undefined}>
          {hasChoices ? `${qtyLabel} total · Modifiers applied` : `(${qtyLabel})`}
        </span>
      </div>

      <div className="order-card__foot" onClick={(e) => e.stopPropagation()}>
        <span className="order-card__total">{formatPeso(totals.total)}</span>
        <ActionButton order={order} selected={selected} onAdvance={() => onAdvance(order)} />
      </div>
    </article>
  );
}
