import { Banknote, CreditCard, Landmark, Pencil, Smartphone, Trash2, Wallet } from 'lucide-react';
import Table, { type TableColumn } from '../../ui/Table';
import { formatPeso } from '../../../utils/currency';
import { formatExpenseDate, type Expense, type ExpensePaymentMethod } from '../../../types/expense';

const methodIcon: Record<ExpensePaymentMethod, typeof Banknote> = {
  Cash: Banknote,
  GCash: Smartphone,
  Card: CreditCard,
  'Bank Transfer': Landmark,
  Other: Wallet,
};

export function CategoryTag({ category }: { category: string }) {
  return <span className={`exp-cat exp-cat--${category.toLowerCase()}`}>{category}</span>;
}

export function PaymentTag({ method }: { method: ExpensePaymentMethod }) {
  const Icon = methodIcon[method];
  return (
    <span className="exp-pay">
      <Icon size={13} /> {method}
    </span>
  );
}

interface ExpenseTableProps {
  expenses: Expense[];
  selectedId: string | null;
  onView: (expense: Expense) => void;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
  empty: React.ReactNode;
}

export default function ExpenseTable({ expenses, selectedId, onView, onEdit, onDelete, empty }: ExpenseTableProps) {
  const columns: TableColumn<Expense>[] = [
    { key: 'date', header: 'Date', width: '10%', render: (e) => <span className="exp-date">{formatExpenseDate(e.date)}</span> },
    { key: 'category', header: 'Category', width: '11%', render: (e) => <CategoryTag category={e.category} /> },
    {
      key: 'description',
      header: 'Description',
      width: '31%',
      render: (e) => (
        <div className="exp-desc">
          <strong>{e.description}</strong>
          {e.notes && <span>{e.notes}</span>}
        </div>
      ),
    },
    { key: 'reference', header: 'Reference', width: '11%', render: (e) => <span className="exp-ref">#{e.code}</span> },
    { key: 'amount', header: 'Amount', width: '10%', align: 'right', render: (e) => <strong className="exp-amount">{formatPeso(e.amount)}</strong> },
    { key: 'payment', header: 'Payment', width: '11%', render: (e) => <PaymentTag method={e.paymentMethod} /> },
    { key: 'by', header: 'Recorded By', width: '9%', render: (e) => <span className="exp-by">{e.recordedBy}</span> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      width: '7%',
      render: (e) => (
        <div className="exp-actions" onClick={(ev) => ev.stopPropagation()}>
          <button type="button" className="icon-btn" aria-label={`Edit ${e.description}`} title="Edit" onClick={() => onEdit(e)}>
            <Pencil size={14} />
          </button>
          <button type="button" className="icon-btn exp-delete" aria-label={`Delete ${e.description}`} title="Delete" onClick={() => onDelete(e)}>
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="exp-table">
      <Table
        columns={columns}
        rows={expenses}
        rowKey={(e) => e.id}
        onRowClick={onView}
        rowClassName={(e) => (e.id === selectedId ? 'exp-row--selected' : undefined)}
        empty={empty}
      />
    </div>
  );
}
