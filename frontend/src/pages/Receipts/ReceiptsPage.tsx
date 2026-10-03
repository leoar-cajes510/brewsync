import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, ReceiptText, RefreshCw } from 'lucide-react';
import LiveClock from '../../components/layout/LiveClock';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import LoadingState from '../../components/ui/LoadingState';
import SearchBar from '../../components/ui/SearchBar';
import Select from '../../components/ui/Select';
import Tabs from '../../components/ui/Tabs';
import ReceiptList, { receiptStatus } from '../../components/receipts/ReceiptList';
import ReceiptPreview from '../../components/receipts/ReceiptPreview';
import ReceiptPrinter, { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import type { Receipt } from '../../types/receipt';
import type { DocumentDto } from '../../types/api';
import { errorMessage } from '../../services/api';
import { listDocuments, printDocument } from '../../services/documentService';
import { isToday } from '../../utils/receipt';
import { businessInfo, receiptFromDocument } from '../../utils/apiMappers';
import '../../components/receipts/receipts.css';

type DateFilter = 'today' | 'yesterday' | 'all';
type PaymentFilter = 'all' | Receipt['payment']['method'];
type StatusFilter = 'all' | 'completed' | 'refunded';

const paymentTabs = [
  { value: 'all', label: 'All Payments' },
  { value: 'cash', label: 'Cash' },
  { value: 'gcash', label: 'GCash / QRPh' },
  { value: 'card', label: 'Card' },
  { value: 'bank-transfer', label: 'Bank Transfer' },
];

const statusTabs = [
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'refunded', label: 'Refunded' },
];

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function matchesDate(date: Date, filter: DateFilter, now: Date) {
  if (filter === 'all') return true;
  if (filter === 'today') return isToday(date, now);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  return isToday(date, y);
}

// Issued sales documents from GET /documents, rendered from their immutable snapshots.
// Printing records a print/reprint on the server; the document number never changes.
export default function ReceiptsPage() {
  const now = useNow();
  const [docs, setDocs] = useState<DocumentDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');
  const [payment, setPayment] = useState<PaymentFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      setDocs(await listDocuments());
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const receipts = useMemo(() => (docs ?? []).filter((d) => d.document_type === 'sales').map(receiptFromDocument), [docs]);
  const todayCount = receipts.filter((r) => isToday(r.issuedAt, now)).length;

  const dateScoped = useMemo(() => receipts.filter((r) => matchesDate(r.issuedAt, dateFilter, now)), [receipts, dateFilter, now]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    return dateScoped.filter(
      (r) =>
        (payment === 'all' || r.payment.method === payment) &&
        (status === 'all' || (status === 'completed' ? r.status === 'completed' : r.status !== 'completed')) &&
        (!q ||
          r.number.toLowerCase().includes(q) ||
          r.orderNumber.includes(q) ||
          r.customer.toLowerCase().includes(q) ||
          r.cashier.toLowerCase().includes(q)),
    );
  }, [dateScoped, payment, status, query]);

  // Preview only what is visible in the list.
  const selected = visible.find((r) => r.id === selectedId) ?? null;

  const markPrinted = async (receipt: Receipt) => {
    try {
      const doc = await printDocument(receipt.id);
      setDocs((prev) => (prev ?? []).map((d) => (d.id === doc.id ? { ...d, print_count: doc.print_count } : d)));
      setFeedback(doc.print_count > 1 ? `Reprint #${doc.print_count - 1} of ${doc.number} recorded` : `${doc.number} printed`);
    } catch (err) {
      setFeedback(errorMessage(err));
    }
  };
  const selectedDoc = docs?.find((d) => d.id === selected?.id) ?? null;

  return (
    <div className="receipts">
      <section className="receipts__workspace">
        <header className="receipts__toolbar">
          <div className="receipts__heading">
            <span className="receipts__heading-icon">
              <ReceiptText size={18} />
            </span>
            <h1 className="receipts__title">Receipts</h1>
            <Badge>{todayCount} entries today</Badge>
          </div>
          <SearchBar
            className="receipts__search"
            placeholder="Search receipt number, order number, customer, or cashier…"
            shortcut="⌘K"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="receipts__status">
            <button type="button" className="receipts__sync" onClick={() => void refresh()} title="Refresh receipts">
              <span className="status-dot" />
              <span className="receipts__sync-label">Refresh</span>
              <RefreshCw size={13} />
            </button>
            <LiveClock now={now} className="receipts__clock" />
          </div>
        </header>

        <div className="receipts__filters">
          <Select
            className="receipts__date"
            aria-label="Date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            options={[
              { value: 'today', label: `Today, ${now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` },
              { value: 'yesterday', label: 'Yesterday' },
              { value: 'all', label: 'All Dates' },
            ]}
          />
          <div className="filter-group">
            <span className="filter-group__label">Payment:</span>
            <Tabs items={paymentTabs} value={payment} onChange={(v) => setPayment(v as PaymentFilter)} variant="chips" />
          </div>
          <div className="filter-group">
            <span className="filter-group__label">Status:</span>
            <Tabs items={statusTabs} value={status} onChange={(v) => setStatus(v as StatusFilter)} variant="chips" />
          </div>
          <div className="receipts__count">
            Showing <strong>{visible.length}</strong> of {dateScoped.length} transactions
            <button type="button" className="icon-btn" aria-label="Export" title="Export (available in a later phase)" disabled>
              <Download size={15} />
            </button>
          </div>
        </div>

        <div className="receipts__list">
          {docs === null ? (
            loadError ? (
              <EmptyState title="Could not load receipts" description={loadError} action={<Button onClick={() => void refresh()}>Try again</Button>} />
            ) : (
              <LoadingState label="Loading receipts…" />
            )
          ) : (
            <ReceiptList receipts={visible} selectedId={selected?.id ?? null} onSelect={(r) => setSelectedId(r.id)} />
          )}
        </div>
      </section>

      <aside className="receipt-panel" aria-label="Receipt preview">
        {selected ? (
          <>
            <header className="receipt-panel__header">
              <div>
                <div className="receipt-panel__title-row">
                  <h2 className="receipt-panel__title">Receipt Preview</h2>
                  <Badge tone={receiptStatus[selected.status].tone} dot>
                    {receiptStatus[selected.status].label}
                  </Badge>
                </div>
                <span className="receipt-panel__ref">
                  Ref: Order #{selected.orderNumber} · {selected.terminal}
                </span>
              </div>
              <ReceiptPrinter receipt={selected} onPrinted={markPrinted} variant="toolbar" onFeedback={setFeedback} />
            </header>
            <div className="receipt-panel__body">
              <ReceiptPreview receipt={selected} business={businessInfo(selectedDoc)} />
            </div>
            <footer className="receipt-panel__footer">
              <ActionFeedback message={feedback} onDone={clearFeedback} />
              <ReceiptPrinter receipt={selected} onPrinted={markPrinted} variant="footer" onFeedback={setFeedback} />
            </footer>
          </>
        ) : (
          <div className="receipt-panel__empty">
            <EmptyState
              icon={<ReceiptText size={22} />}
              title="No receipt selected"
              description="Select a receipt from the list to preview, print, or copy its reference."
            />
          </div>
        )}
      </aside>
    </div>
  );
}
