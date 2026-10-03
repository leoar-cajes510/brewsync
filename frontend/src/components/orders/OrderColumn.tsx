import { Inbox } from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import OrderCard from './OrderCard';
import type { Order, OrderStatus } from '../../types/order';

interface OrderColumnProps {
  status: OrderStatus;
  title: string;
  orders: Order[];
  now: Date;
  selectedId: string | null;
  onSelect: (order: Order) => void;
  onAdvance: (order: Order) => void;
}

// Header stays put; only the card list scrolls.
export default function OrderColumn({ status, title, orders, now, selectedId, onSelect, onAdvance }: OrderColumnProps) {
  return (
    <section className={`order-column order-column--${status}`} aria-label={title}>
      <header className="order-column__header">
        <span className="order-column__dot" />
        <h2 className="order-column__title">{title}</h2>
        <span className="order-column__count">{orders.length}</span>
      </header>
      <div className="order-column__list">
        {orders.length === 0 ? (
          <EmptyState icon={<Inbox size={20} />} title="No orders" />
        ) : (
          orders.map((o) => (
            <OrderCard key={o.id} order={o} now={now} selected={o.id === selectedId} onSelect={onSelect} onAdvance={onAdvance} />
          ))
        )}
      </div>
    </section>
  );
}
