import OrderColumn from './OrderColumn';
import type { Order, OrderStatus } from '../../types/order';

const columns: { status: OrderStatus; title: string }[] = [
  { status: 'pending', title: 'Pending' },
  { status: 'preparing', title: 'Preparing' },
  { status: 'ready', title: 'Ready for Pickup' },
];

interface OrderBoardProps {
  orders: Order[];
  now: Date;
  selectedId: string | null;
  onSelect: (order: Order) => void;
  onAdvance: (order: Order) => void;
}

// Three columns always side by side; no horizontal scrolling between them.
export default function OrderBoard({ orders, ...rest }: OrderBoardProps) {
  return (
    <div className="order-board">
      {columns.map((c) => (
        <OrderColumn key={c.status} status={c.status} title={c.title} orders={orders.filter((o) => o.status === c.status)} {...rest} />
      ))}
    </div>
  );
}
