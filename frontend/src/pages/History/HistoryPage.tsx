import { useCallback, useEffect, useMemo, useState } from 'react';
import { History as HistoryIcon, RefreshCw } from 'lucide-react';
import LiveClock from '../../components/layout/LiveClock';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import LoadingState from '../../components/ui/LoadingState';
import SearchBar from '../../components/ui/SearchBar';
import HistoryFilters, { defaultHistoryFilters, type DateRange, type HistoryFilterState } from '../../components/history/HistoryFilters';
import TransactionTable, { cashierName } from '../../components/history/TransactionTable';
import TransactionDetails from '../../components/history/TransactionDetails';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import type { Transaction } from '../../types/receipt';
import type { DocumentDto, HistoryOrderDto } from '../../types/api';
import { errorMessage } from '../../services/api';
import { formatPeso } from '../../utils/currency';
import { exportReceipts, isoDate } from '../../utils/csv';
import { history, historyDetail, refundOrder } from '../../services/orderService';
import { printDocument } from '../../services/documentService';
import { receiptTotals } from '../../utils/receipt';
import { businessInfo, transactionView } from '../../utils/apiMappers';
import '../../components/history/history.css';

const PAGE_SIZE = 20;

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function inRange(date: Date, range: DateRange, now: Date) {
  if (range === 'all') return true;
  const today = startOfDay(now);
  const day = startOfDay(date);
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (range === 'today') return diffDays === 0;
  if (range === 'yesterday') return diffDays === 1;
  return diffDays >= 0 && diffDays < 7;
}

// Completed orders from GET /history; the selected order's issued document (snapshot,
// print count) comes from GET /history/{id}. Reprints keep the original document number.
export default function HistoryPage() {
  const now = useNow();
  const [rows, setRows] = useState<HistoryOrderDto[] | null>(null);
  const [documents, setDocuments] = useState<Record<string, DocumentDto | null>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<HistoryFilterState>(defaultHistoryFilters);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await history();
      setRows(list.filter((o) => o.status === 'completed'));
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Load the document of the selected transaction (cashier, terminal, print count).
  useEffect(() => {
    if (!selectedId || selectedId in documents) return;
    historyDetail(selectedId)
      .then((detail) => setDocuments((prev) => ({ ...prev, [selectedId]: detail.document })))
      .catch((err) => setFeedback(errorMessage(err)));
  }, [selectedId, documents]);

  const transactions = useMemo(() => (rows ?? []).map((o) => transactionView(o, documents[o.id])), [rows, documents]);
  const cashiers = useMemo(() => [...new Set(transactions.map(cashierName).filter((c) => c && c !== '—'))], [transactions]);

  const todayCount = transactions.filter((t) => inRange(t.issuedAt, 'today', now)).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    return transactions.filter(
      (t) =>
        inRange(t.issuedAt, filters.date, now) &&
        (filters.type === 'all' || t.orderType === filters.type) &&
        (filters.payment === 'all' || t.payment.method === filters.payment) &&
        (filters.cashier === 'all' || cashierName(t) === filters.cashier) &&
        (filters.status === 'all' || t.status === filters.status) &&
        (!q ||
          t.orderNumber.includes(q) ||
          t.number.toLowerCase().includes(q) ||
          t.transactionNumber.toLowerCase().includes(q) ||
          (t.payment.reference ?? '').toLowerCase().includes(q) ||
          t.customer.toLowerCase().includes(q) ||
          t.cashier.toLowerCase().includes(q)),
    );
  }, [transactions, filters, query, now]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const totalVolume = filtered.reduce((sum, t) => sum + receiptTotals(t).total - (t.refundedAmount ?? 0), 0);

  // Details follow the visible list: a filtered-out selection shows the empty state.
  const selected = filtered.find((t) => t.id === selectedId) ?? null;
  const selectedDocument = selected ? documents[selected.id] : undefined;

  const updateFilters = (next: HistoryFilterState) => {
    setFilters(next);
    setPage(1);
  };

  const reprint = async (t: Transaction) => {
    if (!t.documentId) return;
    try {
      const doc = await printDocument(t.documentId);
      setDocuments((prev) => ({ ...prev, [t.id]: doc }));
      setFeedback(doc.print_count > 1 ? `Reprint #${doc.print_count - 1} of receipt ${doc.number} recorded` : `Receipt ${doc.number} printed`);
    } catch (err) {
      setFeedback(errorMessage(err));
    }
  };

  // Success is reported only after the server recorded the refund; the list and the receipt
  // (now marked refunded) are reloaded from the server.
  const refund = async (t: Transaction, reason: string, idempotencyKey: string, amount?: string) => {
    const updated = await refundOrder(t.id, reason, idempotencyKey, amount);
    setDocuments((prev) => {
      const next = { ...prev };
      delete next[t.id];
      return next;
    });
    await refresh();
    setFeedback(amount ? `Refunded ${formatPeso(Number(amount))} on transaction #${updated.number}` : `Transaction #${updated.number} refunded`);
  };

  let table;
  if (rows === null)
    table = loadError ? (
      <EmptyState title="Could not load history" description={loadError} action={<Button onClick={() => void refresh()}>Try again</Button>} />
    ) : (
      <LoadingState label="Loading history…" />
    );
  else
    table = (
      <TransactionTable
        rows={pageRows}
        selectedId={selected?.id ?? null}
        onSelect={(t) => setSelectedId(t.id)}
        page={currentPage}
        pageCount={pageCount}
        pageSize={PAGE_SIZE}
        totalCount={filtered.length}
        totalVolume={totalVolume}
        onPageChange={setPage}
      />
    );

  return (
    <div className="history">
      <section className="history__workspace">
        <header className="history__toolbar">
          <div className="history__heading">
            <span className="history__heading-icon">
              <HistoryIcon size={18} />
            </span>
            <h1 className="history__title">History</h1>
            <Badge>{todayCount} transactions today</Badge>
          </div>
          <SearchBar
            className="history__search"
            placeholder="Search orders, receipts, cashiers, or reference numbers…"
            shortcut="⌘K"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          <div className="history__status">
            <button type="button" className="history__sync" onClick={() => void refresh()} title="Refresh history">
              <span className="status-dot" />
              <span className="history__sync-label">Refresh</span>
              <RefreshCw size={13} />
            </button>
            <LiveClock now={now} className="history__clock" />
          </div>
        </header>

        <HistoryFilters
          value={filters}
          onChange={updateFilters}
          cashiers={cashiers}
          todayLabel={now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          onExport={filtered.length ? () => exportReceipts(`brewsync-history-${isoDate()}.csv`, filtered) : undefined}
        />

        <div className="history__table">{table}</div>
      </section>

      <aside className="txn-panel" aria-label="Transaction details">
        {selected ? (
          selectedDocument === undefined ? (
            <LoadingState label="Loading receipt…" />
          ) : (
            <TransactionDetails
              key={selected.id}
              transaction={selected}
              business={businessInfo(selectedDocument)}
              onClose={() => setSelectedId(null)}
              onReprint={reprint}
              onFeedback={setFeedback}
              onRefund={refund}
            />
          )
        ) : (
          <div className="txn-panel__empty">
            <EmptyState
              icon={<HistoryIcon size={22} />}
              title="No transaction selected"
              description="Select a transaction from the list to see its items, totals, and payment audit record."
            />
          </div>
        )}
        {feedback && (
          <div className="txn-panel__feedback">
            <ActionFeedback message={feedback} onDone={clearFeedback} />
          </div>
        )}
      </aside>
    </div>
  );
}
