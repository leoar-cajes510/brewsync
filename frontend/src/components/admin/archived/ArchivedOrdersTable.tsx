import { Banknote, CreditCard, Eye, History, Landmark, ReceiptText, Smartphone } from 'lucide-react';
import Badge, { type BadgeTone } from '../../ui/Badge';
import Table, { type TableColumn } from '../../ui/Table';
import { formatPeso } from '../../../utils/currency';
import { receiptTotals } from '../../../utils/receipt';
import type { PaymentMethod } from '../../../types/payment';
import type { ReceiptStatus } from '../../../types/receipt';
import { canRestore, type ArchivedOrder } from './archivedData';

const PAY: Record<PaymentMethod, { label: string; icon: typeof Banknote }> = {
  cash: { label: 'Cash', icon: Banknote },
  gcash: { label: 'GCash', icon: Smartphone },
  card: { label: 'Card', icon: CreditCard },
  'bank-transfer': { label: 'Bank Transfer', icon: Landmark },
};

export const TYPE_LABEL = { 'dine-in': 'Dine-In', takeout: 'Takeout', delivery: 'Delivery' } as const;

export const STATUS: Record<ReceiptStatus, { label: string; tone: BadgeTone }> = {
  completed: { label: 'Paid', tone: 'success' },
  refunded: { label: 'Refunded', tone: 'danger' },
  'partial-refund': { label: 'Partial Refund', tone: 'warning' },
};

export const shortDate = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
export const shortTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export function PaymentChip({ method }: { method: PaymentMethod }) {
  const { label, icon: Icon } = PAY[method];
  return (
    <span className="arc-pay">
      <Icon size={13} /> {label}
    </span>
  );
}

export function ArchiveBadge({ order }: { order: ArchivedOrder }) {
  return (
    <span className="arc-status">
      <Badge tone="neutral">Archived · {order.archivedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Badge>
      {order.status !== 'completed' && <Badge tone={STATUS[order.status].tone}>{STATUS[order.status].label}</Badge>}
    </span>
  );
}

interface ArchivedOrdersTableProps {
  orders: ArchivedOrder[];
  selectedId: string | null;
  onSelect: (o: ArchivedOrder) => void;
  onViewReceipt: (o: ArchivedOrder) => void;
  onRestore: (o: ArchivedOrder) => void;
  empty: React.ReactNode;
}

export default function ArchivedOrdersTable({ orders, selectedId, onSelect, onViewReceipt, onRestore, empty }: ArchivedOrdersTableProps) {
  const columns: TableColumn<ArchivedOrder>[] = [
    { key: 'order', header: 'Order #', width: '9%', render: (o) => <strong className="arc-num">#{o.orderNumber}</strong> },
    {
      key: 'date',
      header: 'Date / Time',
      width: '11%',
      render: (o) => (
        <div className="arc-two">
          <span>{shortDate(o.issuedAt)}</span>
          <em>{shortTime(o.issuedAt)}</em>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      width: '15%',
      render: (o) => (
        <div className="arc-two">
          <strong>{o.customer}</strong>
          <em>{o.tag ?? TYPE_LABEL[o.orderType]}</em>
        </div>
      ),
    },
    {
      key: 'staff',
      header: 'Staff / Till',
      width: '12%',
      render: (o) => (
        <div className="arc-two">
          <span>{o.cashier}</span>
          <em>{o.terminal}</em>
        </div>
      ),
    },
    { key: 'type', header: 'Type', width: '8%', render: (o) => <span className={`arc-type arc-type--${o.orderType}`}>{TYPE_LABEL[o.orderType]}</span> },
    {
      key: 'items',
      header: 'Items',
      width: '7%',
      render: (o) => {
        const q = o.items.reduce((s, i) => s + i.quantity, 0);
        return <span className="arc-muted">{q} item{q === 1 ? '' : 's'}</span>;
      },
    },
    { key: 'total', header: 'Total', width: '9%', align: 'right', render: (o) => <strong className="arc-total">{formatPeso(receiptTotals(o).total)}</strong> },
    { key: 'payment', header: 'Payment', width: '11%', render: (o) => <PaymentChip method={o.payment.method} /> },
    { key: 'status', header: 'Status', width: '11%', render: (o) => <ArchiveBadge order={o} /> },
    {
      key: 'actions',
      header: 'Actions',
      width: '9%',
      align: 'right',
      render: (o) => {
        const eligible = canRestore(o);
        return (
          <div className="arc-actions" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="icon-btn" aria-label={`View details of #${o.orderNumber}`} title="View details" onClick={() => onSelect(o)}>
              <Eye size={14} />
            </button>
            <button type="button" className="icon-btn" aria-label={`View receipt of #${o.orderNumber}`} title="View receipt" onClick={() => onViewReceipt(o)}>
              <ReceiptText size={14} />
            </button>
            <button
              type="button"
              className="icon-btn arc-restore-icon"
              aria-label={`Restore #${o.orderNumber}`}
              title={eligible ? 'Restore order' : 'Not eligible for restore'}
              disabled={!eligible}
              onClick={() => onRestore(o)}
            >
              <History size={14} />
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="arc-table">
      <Table columns={columns} rows={orders} rowKey={(o) => o.id} onRowClick={onSelect} rowClassName={(o) => (o.id === selectedId ? 'arc-row--selected' : undefined)} empty={empty} />
    </div>
  );
}
