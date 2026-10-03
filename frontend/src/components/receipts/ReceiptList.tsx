import type { LucideIcon } from 'lucide-react';
import { Banknote, ChevronRight, CreditCard, Eye, Landmark, QrCode, ReceiptText, SearchX, Undo2 } from 'lucide-react';
import Badge, { type BadgeTone } from '../ui/Badge';
import EmptyState from '../ui/EmptyState';
import Table, { type TableColumn } from '../ui/Table';
import type { PaymentMethod } from '../../types/payment';
import type { Receipt, ReceiptStatus } from '../../types/receipt';
import { formatPeso } from '../../utils/currency';
import { orderTypeLabel } from '../../utils/orderDisplay';
import { receiptPaymentLabel, receiptTotals } from '../../utils/receipt';

const methodIcons: Record<PaymentMethod, LucideIcon> = {
  cash: Banknote,
  gcash: QrCode,
  card: CreditCard,
  'bank-transfer': Landmark,
};

export const receiptStatus: Record<ReceiptStatus, { label: string; tone: BadgeTone }> = {
  completed: { label: 'Completed', tone: 'success' },
  refunded: { label: 'Refunded', tone: 'danger' },
  'partial-refund': { label: 'Partial Refund', tone: 'warning' },
};

interface ReceiptListProps {
  receipts: Receipt[];
  selectedId: string | null;
  onSelect: (receipt: Receipt) => void;
}

export default function ReceiptList({ receipts, selectedId, onSelect }: ReceiptListProps) {
  const columns: TableColumn<Receipt>[] = [
    {
      key: 'receipt',
      header: 'Receipt & Order',
      width: '18%',
      render: (r) => (
        <div className="receipt-cell">
          <span className="receipt-cell__icon">{r.status === 'refunded' ? <Undo2 size={15} /> : <ReceiptText size={15} />}</span>
          <div>
            <span className="receipt-cell__number">#{r.number}</span>
            <span className="receipt-cell__sub">Order #{r.orderNumber}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer & Channel',
      width: '21%',
      render: (r) => (
        <div className="stack-cell">
          <span className="stack-cell__main">{r.customer}</span>
          <span className={`channel channel--${r.orderType}`}>
            <span className="status-dot" /> {orderTypeLabel({ type: r.orderType, tag: r.tag })}
          </span>
        </div>
      ),
    },
    {
      key: 'time',
      header: 'Time',
      width: '15%',
      render: (r) => (
        <div className="stack-cell">
          <span className="stack-cell__main mono">
            {r.issuedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="stack-cell__sub">
            {r.terminal} · {r.cashier.split(' (')[0]}
          </span>
        </div>
      ),
    },
    {
      key: 'payment',
      header: 'Payment Method',
      width: '17%',
      render: (r) => {
        const Icon = methodIcons[r.payment.method];
        return (
          <span className="pay-chip">
            <Icon size={13} /> {receiptPaymentLabel(r.payment)}
          </span>
        );
      },
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      width: '11%',
      render: (r) => <span className="receipt-total mono">{formatPeso(receiptTotals(r).total)}</span>,
    },
    {
      key: 'status',
      header: 'Status & Action',
      align: 'right',
      width: '18%',
      render: (r) => (
        <div className="status-cell">
          <Badge tone={receiptStatus[r.status].tone} dot>
            {receiptStatus[r.status].label}
          </Badge>
          {r.id === selectedId ? (
            <span className="status-cell__view" aria-label="Previewing">
              <Eye size={14} />
            </span>
          ) : (
            <ChevronRight size={16} className="status-cell__chevron" />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="receipt-list">
      <Table
        columns={columns}
        rows={receipts}
        rowKey={(r) => r.id}
        onRowClick={onSelect}
        rowClassName={(r) =>
          [r.id === selectedId && 'receipt-row--selected', r.status === 'refunded' && 'receipt-row--refunded']
            .filter(Boolean)
            .join(' ')
        }
        empty={
          <div className="receipt-list__empty">
            <EmptyState icon={<SearchX size={22} />} title="No receipts match" description="Try a different search term, date, or filter." />
          </div>
        }
      />
    </div>
  );
}
