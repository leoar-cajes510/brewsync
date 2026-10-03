import { Link } from 'react-router-dom';
import Badge, { type BadgeTone } from '../../ui/Badge';
import Table, { type TableColumn } from '../../ui/Table';
import type { RecentOrder } from '../../../pages/Admin/adminOverviewData';
import { formatPeso } from '../../../utils/currency';

const statusBadge: Record<RecentOrder['status'], { label: string; tone: BadgeTone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  preparing: { label: 'Preparing', tone: 'brand' },
  ready: { label: 'Ready', tone: 'success' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  refunded: { label: 'Refunded', tone: 'danger' },
};

const typeLabel: Record<RecentOrder['type'], string> = { 'dine-in': 'Dine-In', takeout: 'Takeout', delivery: 'Delivery' };

const columns: TableColumn<RecentOrder>[] = [
  { key: 'order', header: 'Order', render: (o) => <strong>#{o.number}</strong> },
  { key: 'customer', header: 'Tag', render: (o) => o.customer },
  { key: 'type', header: 'Type', render: (o) => <span className="recent-type">{typeLabel[o.type]}</span> },
  { key: 'amount', header: 'Amount', align: 'right', render: (o) => <strong>{formatPeso(o.amount)}</strong> },
  {
    key: 'status',
    header: 'Status',
    render: (o) => (
      <Badge tone={statusBadge[o.status].tone} dot>
        {statusBadge[o.status].label}
      </Badge>
    ),
  },
  { key: 'time', header: 'Time', align: 'right', render: (o) => <span className="text-muted">{o.time}</span> },
];

export default function RecentOrders({ orders }: { orders: RecentOrder[] }) {
  return (
    <section className="ov-card recent-orders">
      <header className="ov-card__header">
        <h2 className="ov-card__title">Recent Orders</h2>
        <Link to="/orders" className="ov-link">
          Open Orders Board
        </Link>
      </header>
      <Table columns={columns} rows={orders} rowKey={(o) => o.number} emptyTitle="No orders yet" />
    </section>
  );
}
