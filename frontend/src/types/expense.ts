// Admin → Expenses: business spending, persisted via /expenses (the server records who logged it).

export const EXPENSE_CATEGORIES = ['Supplies', 'Ingredients', 'Utilities', 'Rent', 'Equipment', 'Maintenance', 'Transportation', 'Marketing', 'Other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const PAYMENT_METHODS = ['Cash', 'GCash', 'Card', 'Bank Transfer', 'Other'] as const;
export type ExpensePaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface ExpenseDraft {
  category: ExpenseCategory;
  description: string;
  amount: number;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  paymentMethod: ExpensePaymentMethod;
  notes: string;
  recordedBy: string;
}

export interface Expense extends ExpenseDraft {
  id: string;
  /** Auto reference, e.g. EXP-2026-001. */
  code: string;
  createdAt: Date;
}

/** Local YYYY-MM-DD for a Date (not UTC). */
export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatExpenseDate(s: string): string {
  return parseISODate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
