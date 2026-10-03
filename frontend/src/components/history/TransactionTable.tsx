import type { LucideIcon } from 'lucide-react';
import { Banknote, CreditCard, Landmark, QrCode, SearchX } from 'lucide-react';
import Badge, { type BadgeTone } from '../ui/Badge';
import EmptyState from '../ui/EmptyState';
import Pagination from '../ui/Pagination';
import Table, { type TableColumn } from '../ui/Table';
import type { OrderType } from '../../types/order';
import type { PaymentMethod } from '../../types/payment';
import type { ReceiptStatus, Transaction } from '../../types/receipt';
import { formatPeso } from '../../utils/currency';
import { receiptPaymentLabel, receiptTotals } from '../../utils/receipt';

const methodIcons: Record<PaymentMethod, LucideIcon> = {
  cash: Banknote,
  gcash: QrCode,
  card: CreditCard,
  'bank-transfer': Landmark,
};

const typeLabels: Record<OrderType, string> = { 'dine-in': 'Dine-In', takeout: 'Takeout', delivery: 'Delivery' };

export const transactionStatus: Record<ReceiptStatus, { label: string; tone: BadgeTone }> = {
  completed: { label: 'Completed', tone: 'success' },
  refunded: { label: 'Refunded', tone: 'danger' },
  'partial-refund': { label: 'Partially Refunded', tone: 'warning' },
};

export const cashierName = (t: Transaction) => t.cashier.split(' (')[0];

interface TransactionTableProps {
  rows: Transaction[];
  selectedId: string | null;
  onSelect: (t: Transaction) => void;
  page: number;
  pageCount: number;
  pageSize: number;
  totalCount: number;
  totalVolume: number;
  onPageChange: (page: number) => void;
}

export default function TransactionTable({
  rows,
  selectedId,
  onSelect,
  page,
  pageCount,
  pageSize,
  totalCount,
  totalVolume,
  onPageChange,
}: TransactionTableProps) {
  const columns: TableColumn<Transaction>[] = [
    { key: 'order', header: 'Order #', width: '9%', render: (t) => <span className="txn-order">#{t.orderNumber}</span> },
    { key: 'receipt', header: 'Receipt #', width: '9%', render: (t) => <span className="txn-mono">{t.number}</span> },
    {
      key: 'date',
      header: 'Date / Time',
      width: '12%',
      render: (t) => (
        <div className="txn-stack">
          <strong>{t.issuedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</strong>
          <span>{t.issuedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer & Dining',
      width: '20%',
      render: (t) => (
        <div className="txn-stack">
          <strong>{t.customer}</strong>
          <span>
            <span className="txn-type">{typeLabels[t.orderType]}</span>
            {t.tag && ` · ${t.tag}`}
          </span>
        </div>
      ),
    },
    {
      key: 'cashier',
      header: 'Cashier',
      width: '11%',
      render: (t) => (
        <span className="txn-cashier">
          <span className={`txn-avatar txn-avatar--${cashierName(t).toLowerCase()}`}>{cashierName(t)[0]}</span>
          {cashierName(t)}
        </span>
      ),
    },
    {
      key: 'payment',
      header: 'Payment Method',
      width: '16%',
      render: (t) => {
        const Icon = methodIcons[t.payment.method];
        return (
          <span className="txn-pay">
            <Icon size={14} />
            <span>{receiptPaymentLabel(t.payment)}</span>
          </span>
        );
      },
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      width: '10%',
      render: (t) => <span className={`txn-total txn-total--${t.status}`}>{formatPeso(receiptTotals(t).total)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      width: '13%',
      render: (t) => (
        <Badge tone={transactionStatus[t.status].tone} dot>
          {transactionStatus[t.status].label}
        </Badge>
      ),
    },
  ];

  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  return (
    <div className="txn-card">
      <div className="txn-card__table">
        <Table
          columns={columns}
          rows={rows}
          rowKey={(t) => t.id}
          onRowClick={onSelect}
          rowClassName={(t) => (t.id === selectedId ? 'txn-row--selected' : undefined)}
          empty={
            <div className="txn-card__empty">
              <EmptyState icon={<SearchX size={22} />} title="No transactions found" description="Try a different search, date range, or filter." />
            </div>
          }
        />
      </div>
      <footer className="txn-card__footer">
        <span>
          Showing{' '}
          <strong>
            {from}–{to}
          </strong>{' '}
          of <strong>{totalCount}</strong> {totalCount === 1 ? 'transaction' : 'transactions'}
        </span>
        <span className="txn-card__divider" />
        <span>
          Total Volume: <strong>{formatPeso(totalVolume)}</strong>
        </span>
        <div className="txn-card__pages">
          <Pagination page={page} pageCount={pageCount} onChange={onPageChange} />
        </div>
      </footer>
    </div>
  );
}
