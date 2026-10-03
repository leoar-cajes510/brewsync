import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CalendarRange, Download, PieChart, Plus, Receipt, SearchX, Trash2, Pencil } from 'lucide-react';
import Button from '../../components/ui/Button';
import LoadingState from '../../components/ui/LoadingState';
import Drawer from '../../components/ui/Drawer';
import EmptyState from '../../components/ui/EmptyState';
import Pagination from '../../components/ui/Pagination';
import SearchBar from '../../components/ui/SearchBar';
import Select from '../../components/ui/Select';
import Tabs from '../../components/ui/Tabs';
import ExpenseTable, { CategoryTag, PaymentTag } from '../../components/admin/expenses/ExpenseTable';
import ExpenseForm from '../../components/admin/expenses/ExpenseForm';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import { formatPeso } from '../../utils/currency';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, formatExpenseDate, toISODate, type Expense, type ExpenseCategory, type ExpenseDraft, type ExpensePaymentMethod } from '../../types/expense';
import type { ExpenseDto } from '../../types/api';
import { errorMessage } from '../../services/api';
import { listExpenses, recordExpense, updateExpense } from '../../services/expenseService';
import { listStaff } from '../../services/staffService';
import '../../components/admin/expenses/expenses.css';

const ALL = 'all';
const PAGE_SIZE = 10;
type Period = 'all' | 'today' | 'week' | 'month' | 'last-month';

/** Delete vs void of an expense is ⚠ OPEN (Q-EXP-1); the server exposes neither. */
const DELETE_PENDING = 'Deleting or voiding an expense is not available yet — that policy is still an open decision (Q-EXP-1). Edit the record instead.';

function fromDto(e: ExpenseDto, names: Map<string, string>): Expense {
  return {
    id: e.id,
    code: e.code,
    category: e.category as ExpenseCategory,
    description: e.description,
    amount: Number(e.amount),
    date: e.expense_date,
    paymentMethod: e.payment_method as ExpensePaymentMethod,
    notes: e.notes,
    recordedBy: names.get(e.recorded_by) ?? '—',
    createdAt: e.created_at ? new Date(e.created_at) : new Date(`${e.expense_date}T00:00:00`),
  };
}

/** Inclusive YYYY-MM-DD bounds for a period, relative to today (weeks start Monday). */
function periodRange(period: Period, now = new Date()): [string, string] | null {
  const today = toISODate(now);
  if (period === 'today') return [today, today];
  if (period === 'week') {
    const start = new Date(now);
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return [toISODate(start), today];
  }
  if (period === 'month') return [toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), today];
  if (period === 'last-month') return [toISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), toISODate(new Date(now.getFullYear(), now.getMonth(), 0))];
  return null;
}

const inPeriod = (e: Expense, period: Period) => {
  const r = periodRange(period);
  return !r || (e.date >= r[0] && e.date <= r[1]);
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function downloadCsv(rows: Expense[]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    ['Date', 'Reference', 'Category', 'Description', 'Amount', 'Payment Method', 'Notes', 'Recorded By'],
    ...rows.map((e) => [e.date, e.code, e.category, e.description, e.amount.toFixed(2), e.paymentMethod, e.notes, e.recordedBy]),
  ];
  const url = URL.createObjectURL(new Blob([lines.map((l) => l.map(esc).join(',')).join('\n')], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `brewsync-expenses-${toISODate(new Date())}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

// Business spending (GET/POST/PATCH /expenses). A fresh business has no expenses.
export default function AdminExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [method, setMethod] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const refresh = useCallback(async () => {
    try {
      const [list, staff] = await Promise.all([listExpenses(), listStaff().catch(() => [])]);
      const names = new Map(staff.map((s) => [s.id, s.full_name]));
      setExpenses(list.map((e) => fromDto(e, names)));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sorted = useMemo(() => [...expenses].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.getTime() - a.createdAt.getTime()), [expenses]);
  const viewing = expenses.find((e) => e.id === viewingId) ?? null;

  const summary = useMemo(() => {
    const sum = (list: Expense[]) => list.reduce((s, e) => s + e.amount, 0);
    const of = (p: Period) => expenses.filter((e) => inPeriod(e, p));
    const today = of('today');
    const week = of('week');
    const month = of('month');
    const byCat = new Map<string, number>();
    month.forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount));
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      today: { total: sum(today), count: today.length },
      week: { total: sum(week), count: week.length },
      month: { total: sum(month), count: month.length },
      all: { total: sum(expenses), count: expenses.length },
      top: top ? { name: top[0], total: top[1], share: Math.round((top[1] / sum(month)) * 1000) / 10 } : null,
    };
  }, [expenses]);

  // Search + date + method narrow the set; category chips count within it.
  const base = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter(
      (e) =>
        inPeriod(e, period) &&
        (method === ALL || e.paymentMethod === method) &&
        (!q || [e.description, e.category, e.code, e.notes, e.recordedBy].some((v) => v.toLowerCase().includes(q))),
    );
  }, [sorted, query, period, method]);
  const filtered = category === ALL ? base : base.filter((e) => e.category === category);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const chipCategories = EXPENSE_CATEGORIES.filter((c) => base.some((e) => e.category === c) || c === category);

  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (e: Expense) => {
    setEditing(e);
    setFormOpen(true);
  };

  const save = async (draft: ExpenseDraft) => {
    if (saving) return;
    setSaving(true);
    const body = {
      category: draft.category,
      description: draft.description,
      amount: draft.amount.toFixed(2),
      expense_date: draft.date,
      payment_method: draft.paymentMethod,
      notes: draft.notes,
    };
    try {
      if (editing) {
        await updateExpense(editing.id, body);
        setFeedback(`#${editing.code} updated`);
      } else {
        const created = await recordExpense(body);
        setFeedback(`#${created.code} · ${formatPeso(draft.amount)} expense recorded`);
      }
      await refresh();
      setFormOpen(false);
      setEditing(null);
    } catch (err) {
      setFeedback(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const kpis = [
    { key: 'today', label: "Today's Expenses", value: formatPeso(summary.today.total), sub: `${plural(summary.today.count, 'record')} logged today`, icon: CalendarDays },
    { key: 'week', label: 'This Week', value: formatPeso(summary.week.total), sub: `${plural(summary.week.count, 'record')} since Monday`, icon: CalendarRange },
    { key: 'month', label: 'This Month', value: formatPeso(summary.month.total), sub: `${plural(summary.month.count, 'record')} this month`, icon: CalendarDays },
    {
      key: 'total',
      label: 'Total Expenses',
      value: formatPeso(summary.all.total),
      sub: summary.top ? `Top this month: ${summary.top.name} (${summary.top.share}%)` : `${plural(summary.all.count, 'record')} recorded`,
      icon: PieChart,
    },
  ];

  const noExpenses = expenses.length === 0;
  const periodLabel = { all: 'All Time', today: 'Today', week: 'This Week', month: 'This Month', 'last-month': 'Last Month' };

  return (
    <div className="admin-expenses">
      <section className="exp-kpis" aria-label="Expense summary">
        {kpis.map(({ key, label, value, sub, icon: Icon }) => (
          <article key={key} className="exp-kpi">
            <div className="exp-kpi__head">
              <span>{label}</span>
              <span className="exp-kpi__icon">
                <Icon size={15} />
              </span>
            </div>
            <strong className="exp-kpi__value">{value}</strong>
            <p>{sub}</p>
          </article>
        ))}
      </section>

      <section className="exp-card">
        <div className="exp-toolbar">
          <SearchBar
            className="exp-toolbar__search"
            placeholder="Search by description, category, reference, recorded by…"
            aria-label="Search expenses"
            value={query}
            onChange={(e) => resetPage(setQuery)(e.target.value)}
          />
          <Select
            className="exp-toolbar__select"
            aria-label="Filter by date"
            value={period}
            onChange={(e) => resetPage(setPeriod)(e.target.value as Period)}
            options={(Object.keys(periodLabel) as Period[]).map((p) => ({ value: p, label: periodLabel[p] }))}
          />
          <Select
            className="exp-toolbar__select"
            aria-label="Filter by payment method"
            value={method}
            onChange={(e) => resetPage(setMethod)(e.target.value)}
            options={[{ value: ALL, label: 'All Methods' }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: m }))]}
          />
          <Button icon={<Download size={15} />} disabled={filtered.length === 0} onClick={() => downloadCsv(filtered)}>
            Export CSV
          </Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={openAdd}>
            Add Expense
          </Button>
        </div>
        {!noExpenses && (
          <div className="exp-chips">
            <span className="exp-chips__label">Category:</span>
            <Tabs
              variant="chips"
              items={[{ value: ALL, label: 'All', count: base.length }, ...chipCategories.map((c) => ({ value: c, label: c, count: base.filter((e) => e.category === c).length }))]}
              value={category}
              onChange={resetPage(setCategory)}
            />
          </div>
        )}

        <ExpenseTable
          expenses={rows}
          selectedId={viewingId}
          onView={(e) => setViewingId(e.id)}
          onEdit={openEdit}
          onDelete={() => setFeedback(DELETE_PENDING)}
          empty={
            loading ? (
              <LoadingState label="Loading expenses…" />
            ) : loadError ? (
              <EmptyState title="Could not load expenses" description={loadError} action={<Button onClick={() => void refresh()}>Try again</Button>} />
            ) : noExpenses ? (
              <EmptyState
                icon={<Receipt size={22} />}
                title="No expenses recorded yet"
                description="Record your first business expense to start tracking spending."
                action={
                  <Button variant="primary" icon={<Plus size={16} />} onClick={openAdd}>
                    Add Expense
                  </Button>
                }
              />
            ) : (
              <EmptyState icon={<SearchX size={22} />} title="No expenses match" description="Try a different search, date range, category, or payment method." />
            )
          }
        />

        <footer className="exp-footer">
          <span>
            Showing {filtered.length ? (current - 1) * PAGE_SIZE + 1 : 0}–{Math.min(current * PAGE_SIZE, filtered.length)} of {plural(filtered.length, 'expense')}
            {filtered.length > 0 && (
              <>
                {' '}
                · <strong>{formatPeso(filtered.reduce((s, e) => s + e.amount, 0))}</strong> shown
              </>
            )}
          </span>
          {pageCount > 1 && <Pagination page={current} pageCount={pageCount} onChange={setPage} />}
        </footer>
      </section>

      <ExpenseForm
        open={formOpen}
        expense={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSave={(d) => void save(d)}
      />

      <Drawer
        open={viewing !== null}
        onClose={() => setViewingId(null)}
        title={viewing ? `Expense #${viewing.code}` : ''}
        footer={
          viewing && (
            <>
              <Button icon={<Trash2 size={14} />} className="exp-detail__delete" onClick={() => setFeedback(DELETE_PENDING)}>
                Delete
              </Button>
              <Button variant="primary" icon={<Pencil size={14} />} onClick={() => openEdit(viewing)}>
                Edit Expense
              </Button>
            </>
          )
        }
      >
        {viewing && (
          <div className="exp-detail">
            <div className="exp-detail__amount">
              <span>Amount</span>
              <strong>{formatPeso(viewing.amount)}</strong>
            </div>
            <dl>
              <dt>Category</dt>
              <dd>
                <CategoryTag category={viewing.category} />
              </dd>
              <dt>Description</dt>
              <dd>{viewing.description}</dd>
              <dt>Date</dt>
              <dd>{formatExpenseDate(viewing.date)}</dd>
              <dt>Payment Method</dt>
              <dd>
                <PaymentTag method={viewing.paymentMethod} />
              </dd>
              <dt>Reference / Notes</dt>
              <dd>{viewing.notes || '—'}</dd>
              <dt>Recorded By</dt>
              <dd>{viewing.recordedBy}</dd>
              <dt>Recorded At</dt>
              <dd>{viewing.createdAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</dd>
            </dl>
          </div>
        )}
      </Drawer>

      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}

