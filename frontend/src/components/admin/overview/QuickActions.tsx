import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, CheckCircle2, Package, Plus, Receipt, Zap } from 'lucide-react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Modal from '../../ui/Modal';
import Select from '../../ui/Select';
import { errorMessage } from '../../../services/api';
import { EXPENSE_PAYMENT_METHODS, recordExpense } from '../../../services/expenseService';

interface QuickActionsProps {
  /** Product categories (reserved for a quick product form; Add Product opens Admin → Products). */
  categories: string[];
  expenseCategories: string[];
  /** Called after an expense is saved so the Overview reloads its figures. */
  onRecorded?: () => void;
}

type Dialog = 'expense' | null;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Tile {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  primary?: boolean;
  onClick: () => void;
}

// Add Product opens the full product form (code, tax class, stock); Record Expense saves via POST /expenses.
export default function QuickActions({ expenseCategories, onRecorded }: QuickActionsProps) {
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [expense, setExpense] = useState({ description: '', category: '', amount: '', method: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setDialog(null);
    setSaved(null);
    setError(null);
    setExpense({ description: '', category: '', amount: '', method: '' });
  };

  const tiles: Tile[] = [
    { id: 'add-product', label: 'Add Product', hint: 'New menu item', icon: Plus, primary: true, onClick: () => navigate('/admin/products') },
    { id: 'view-inventory', label: 'View Inventory', hint: 'Stock & alerts', icon: Package, onClick: () => navigate('/admin/inventory') },
    { id: 'record-expense', label: 'Record Expense', hint: 'Log a purchase', icon: Receipt, onClick: () => setDialog('expense') },
    { id: 'view-analytics', label: 'View Analytics', hint: 'Trends & reports', icon: BarChart3, onClick: () => navigate('/admin/analytics') },
  ];

  const expenseValid = expense.description.trim() && expense.category && expense.method && Number(expense.amount) > 0;

  const submitExpense = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const saved = await recordExpense({
        description: expense.description.trim(),
        category: expense.category,
        amount: expense.amount,
        expense_date: today(),
        payment_method: expense.method,
      });
      setSaved(`${saved.code} · ${saved.description}`);
      onRecorded?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="ov-card quick-actions" aria-label="Administrative Quick Actions">
      <header className="ov-card__header">
        <h2 className="ov-card__title">Administrative Quick Actions</h2>
        <Zap size={17} className="quick-actions__zap" />
      </header>
      <div className="quick-actions__grid">
        {tiles.map(({ id, label, hint, icon: Icon, primary, onClick }) => (
          <button key={id} type="button" className={`qa-tile ${primary ? 'qa-tile--primary' : ''}`} onClick={onClick}>
            <span className="qa-tile__icon">
              <Icon size={18} />
            </span>
            <strong>{label}</strong>
            <span>{hint}</span>
          </button>
        ))}
      </div>

      <Modal
        open={dialog === 'expense'}
        onClose={close}
        title="Record Expense"
        size="sm"
        footer={
          saved ? (
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          ) : (
            <>
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" disabled={!expenseValid || submitting} onClick={() => void submitExpense()}>
                {submitting ? 'Saving…' : 'Record Expense'}
              </Button>
            </>
          )
        }
      >
        {saved ? (
          <p className="qa-done">
            <CheckCircle2 size={18} /> “{saved}” recorded.
          </p>
        ) : (
          <div className="qa-form">
            <Input label="Description" placeholder="e.g. Ice delivery" value={expense.description} onChange={(e) => setExpense({ ...expense, description: e.target.value })} />
            <Select
              label="Category"
              placeholder="Select a category"
              value={expense.category}
              onChange={(e) => setExpense({ ...expense, category: e.target.value })}
              options={expenseCategories.map((c) => ({ value: c, label: c }))}
            />
            <Input label="Amount (₱)" type="number" min={0} inputMode="decimal" placeholder="0.00" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} />
            <Select
              label="Payment Method"
              placeholder="Select a payment method"
              value={expense.method}
              onChange={(e) => setExpense({ ...expense, method: e.target.value })}
              options={EXPENSE_PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
            />
            {error && <p className="field__error">{error}</p>}
          </div>
        )}
      </Modal>
    </section>
  );
}
