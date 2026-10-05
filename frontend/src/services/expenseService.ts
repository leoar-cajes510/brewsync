import { api } from './api';
import type { ExpenseDto } from '../types/api';

/** Categories and payment methods accepted by the server (ExpenseCategory / ExpensePaymentMethod). */
export const EXPENSE_CATEGORIES = ['Supplies', 'Ingredients', 'Utilities', 'Rent', 'Equipment', 'Maintenance', 'Transportation', 'Marketing', 'Other'];
export const EXPENSE_PAYMENT_METHODS = ['Cash', 'GCash', 'Card', 'Bank Transfer', 'Other'];

export const listExpenses = () => api.get<ExpenseDto[]>('/expenses');

export interface NewExpense {
  category: string;
  description: string;
  /** Decimal string; validated by the server. */
  amount: string;
  /** ISO date (YYYY-MM-DD); the server rejects future dates. */
  expense_date: string;
  payment_method: string;
  notes?: string;
}

/** ``idempotencyKey``: keep the same key for retries of one form submission (no duplicate expense). */
export const recordExpense = (expense: NewExpense, idempotencyKey?: string) => api.post<ExpenseDto>('/expenses', expense, idempotencyKey);

export const updateExpense = (id: string, patch: Partial<NewExpense>) => api.patch<ExpenseDto>(`/expenses/${id}`, patch);
