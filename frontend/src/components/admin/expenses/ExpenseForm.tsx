import { useEffect, useState } from 'react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Modal from '../../ui/Modal';
import Select from '../../ui/Select';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, toISODate, type Expense, type ExpenseCategory, type ExpenseDraft, type ExpensePaymentMethod } from '../../../types/expense';

interface ExpenseFormProps {
  open: boolean;
  /** null = recording a new expense; otherwise editing it. */
  expense: Expense | null;
  onClose: () => void;
  onSave: (draft: ExpenseDraft) => void;
}

interface FormText {
  category: string;
  description: string;
  amount: string;
  date: string;
  paymentMethod: string;
  notes: string;
  recordedBy: string;
}

const blank = (): FormText => ({ category: '', description: '', amount: '', date: toISODate(new Date()), paymentMethod: 'Cash', notes: '', recordedBy: '' });

// Shared by Add Expense and Edit Expense.
export default function ExpenseForm({ open, expense, onClose, onSave }: ExpenseFormProps) {
  const [f, setF] = useState<FormText>(blank);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubmitted(false);
    setF(expense ? { ...expense, amount: String(expense.amount) } : blank());
  }, [open, expense]);

  const set = (patch: Partial<FormText>) => setF((x) => ({ ...x, ...patch }));
  const today = toISODate(new Date());
  const amount = Number(f.amount);

  const errors = {
    category: !f.category ? 'Choose a category.' : undefined,
    description: !f.description.trim() ? 'Description is required.' : undefined,
    amount: !(f.amount.trim() && amount > 0) ? 'Enter an amount greater than 0.' : undefined,
    date: !f.date ? 'Choose a date.' : f.date > today ? 'Date cannot be in the future.' : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);

  const submit = () => {
    setSubmitted(true);
    if (!valid) return;
    onSave({
      category: f.category as ExpenseCategory,
      description: f.description.trim(),
      amount: Math.round(amount * 100) / 100,
      date: f.date,
      paymentMethod: f.paymentMethod as ExpensePaymentMethod,
      notes: f.notes.trim(),
      recordedBy: f.recordedBy.trim() || 'Admin',
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={expense ? `Edit Expense · #${expense.code}` : 'Add Expense'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            {expense ? 'Save Changes' : 'Record Expense'}
          </Button>
        </>
      }
    >
      <div className="exp-form">
        <div className="exp-form__cell">
          <Select
            label="Category"
            placeholder="Select category…"
            value={f.category}
            onChange={(e) => set({ category: e.target.value })}
            options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))}
          />
          {err('category') && <span className="field__error">{err('category')}</span>}
        </div>
        <Input label="Amount (₱)" type="number" min={0} step="0.01" inputMode="decimal" placeholder="0.00" value={f.amount} error={err('amount')} onChange={(e) => set({ amount: e.target.value })} />
        <Input
          className="exp-form__wide"
          label="Description"
          placeholder="e.g. Paper cups & lids bulk pack"
          maxLength={100}
          value={f.description}
          error={err('description')}
          onChange={(e) => set({ description: e.target.value })}
          autoFocus
        />
        <Input label="Date" type="date" max={today} value={f.date} error={err('date')} onChange={(e) => set({ date: e.target.value })} />
        <Select label="Payment Method" value={f.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value })} options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
        <div className="field exp-form__wide">
          <label className="field__label" htmlFor="exp-notes">
            Reference / Notes (optional)
          </label>
          <textarea
            id="exp-notes"
            className="input exp-form__notes"
            placeholder="Supplier, OR / invoice no., details…"
            maxLength={200}
            value={f.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </div>
      </div>
    </Modal>
  );
}
