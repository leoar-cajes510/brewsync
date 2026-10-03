import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  CalendarDays,
  CheckCircle2,
  Download,
  History,
  SearchX,
  TrendingUp,
} from "lucide-react";
import Button from "../../components/ui/Button";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import EmptyState from "../../components/ui/EmptyState";
import Modal from "../../components/ui/Modal";
import Pagination from "../../components/ui/Pagination";
import SearchBar from "../../components/ui/SearchBar";
import Select from "../../components/ui/Select";
import LoadingState from "../../components/ui/LoadingState";
import ArchivedOrdersTable, {
  TYPE_LABEL,
} from "../../components/admin/archived/ArchivedOrdersTable";
import ArchivedOrderDetails from "../../components/admin/archived/ArchivedOrderDetails";
import {
  DATE_LABELS,
  canRestore,
  inDatePreset,
  type ArchivedOrder,
  type DatePreset,
} from "../../components/admin/archived/archivedData";
import ReceiptPreview from "../../components/receipts/ReceiptPreview";
import ReceiptPrinter, {
  ActionFeedback,
} from "../../components/receipts/ReceiptPrinter";
import { formatPeso } from "../../utils/currency";
import { receiptTotals } from "../../utils/receipt";
import type { DocumentDto, OrderDto } from "../../types/api";
import { errorMessage } from "../../services/api";
import { archiveOrders, listArchive, restoreOrder } from "../../services/archiveService";
import Input from "../../components/ui/Input";
import { historyDetail } from "../../services/orderService";
import { printDocument } from "../../services/documentService";
import { businessInfo, transactionView } from "../../utils/apiMappers";
import "../../components/receipts/receipts.css";
import "../../components/admin/archived/archived.css";

const ALL = "all";
const PAGE_SIZE = 10;

function fromDto(o: OrderDto): ArchivedOrder {
  return {
    ...transactionView({ ...o, document: null }),
    archivedAt: new Date(String(o.archived_at)),
    archivedBy: o.archived_by ? (o.archived_by_name ?? "Unknown user") : "System (automatic)",
    orderStatus: o.status,
  };
}

// Orders moved out of the active workflow (GET /archive, Admin only). A fresh system has an
// empty archive. Restore eligibility (completed only, within the configured restore window) is
// decided by the server; an expired window is answered with RESTORE_WINDOW_EXPIRED.
export default function AdminArchivedOrdersPage() {
  const [orders, setOrders] = useState<ArchivedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [receiptDoc, setReceiptDoc] = useState<{ receipt: ArchivedOrder; document: DocumentDto | null } | null>(null);
  const [query, setQuery] = useState("");
  const [date, setDate] = useState<DatePreset>("all");
  const [type, setType] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<ArchivedOrder | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);
  // Cancelled orders are never auto-archived; the Admin reviews and archives them with a reason (Q-ARC-4).
  const [review, setReview] = useState<OrderDto[]>([]);
  const [archiving, setArchiving] = useState<OrderDto | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const archiveCancelled = async () => {
    if (!archiving) return;
    if (!archiveReason.trim()) {
      setArchiveError("Enter a reason for archiving.");
      return;
    }
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      await archiveOrders([archiving.id], archiveReason.trim());
      setFeedback(`#${archiving.number} archived`);
      setArchiving(null);
      setArchiveReason("");
      await refresh();
    } catch (err) {
      setArchiveError(errorMessage(err));
    } finally {
      setArchiveBusy(false);
    }
  };

  const refresh = useCallback(async () => {
    try {
      const data = await listArchive();
      setOrders(data.archived.map(fromDto));
      setReview(data.cancelled_review);
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

  // Open the receipt of an archived order from its issued document (History detail).
  useEffect(() => {
    if (!receiptId) return setReceiptDoc(null);
    let cancelled = false;
    void historyDetail(receiptId)
      .then((d) => {
        if (!cancelled) setReceiptDoc({ receipt: { ...fromDto(d), ...transactionView({ ...d, document: null }, d.document) }, document: d.document });
      })
      .catch((err) => !cancelled && setFeedback(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [receiptId]);

  const sorted = useMemo(
    () =>
      [...orders].sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime()),
    [orders],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "");
    return sorted.filter(
      (o) =>
        inDatePreset(o.issuedAt, date) &&
        (type === ALL || o.orderType === type) &&
        (status === ALL || o.status === status) &&
        (!q ||
          [o.orderNumber, o.number, o.customer, o.cashier].some((v) =>
            v.toLowerCase().includes(q),
          )),
    );
  }, [sorted, query, date, type, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const selected = orders.find((o) => o.id === selectedId) ?? null;
  const receiptFor = orders.find((o) => o.id === receiptId) ?? null;

  const summary = useMemo(() => {
    const month = orders.filter((o) => inDatePreset(o.issuedAt, "month"));
    const volume = month.reduce((s, o) => s + receiptTotals(o).total, 0);
    const settled = orders.filter((o) => o.status === "completed").length;
    return {
      total: orders.length,
      volume,
      monthCount: month.length,
      avg: month.length ? volume / month.length : 0,
      settledPct: orders.length
        ? Math.round((settled / orders.length) * 1000) / 10
        : null,
      settled,
      eligible: orders.filter((o) => canRestore(o)).length,
    };
  }, [orders]);

  const resetPage =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setPage(1);
    };

  const confirmRestore = async () => {
    if (!restoring) return;
    const target = restoring;
    setRestoring(null);
    try {
      await restoreOrder(target.id);
      if (selectedId === target.id) setSelectedId(null);
      await refresh();
      setFeedback(`#${target.orderNumber} restored to History`);
    } catch (err) {
      setFeedback(errorMessage(err));
    }
  };

  const exportCsv = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      [
        "Order #",
        "Date",
        "Customer",
        "Cashier",
        "Terminal",
        "Type",
        "Items",
        "Total",
        "Payment",
        "Status",
        "Archived At",
      ],
      ...filtered.map((o) => [
        o.orderNumber,
        o.issuedAt.toISOString(),
        o.customer,
        o.cashier,
        o.terminal,
        TYPE_LABEL[o.orderType],
        o.items.reduce((s, i) => s + i.quantity, 0),
        receiptTotals(o).total.toFixed(2),
        o.payment.method,
        o.status,
        o.archivedAt.toISOString(),
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(
        [
          `${lines.map((l) => l.map(esc).join(",")).join("\n")}`,
        ],
        { type: "text/csv" },
      ),
    );
    Object.assign(document.createElement("a"), {
      href: url,
      download: `brewsync-archived-orders.csv`,
    }).click();
    URL.revokeObjectURL(url);
  };

  const kpis = [
    {
      key: "total",
      label: "Total Archived",
      value: String(summary.total),
      unit: "orders",
      sub: "In the archive",
      icon: Archive,
      tone: "",
    },
    {
      key: "volume",
      label: "Archived Volume (This Month)",
      value: formatPeso(summary.volume),
      sub: summary.monthCount
        ? `Avg ticket ${formatPeso(summary.avg)} across ${summary.monthCount} bills`
        : "No archived orders this month",
      icon: TrendingUp,
      tone: "",
    },
    {
      key: "settled",
      label: "Completed & Settled",
      value: summary.settledPct === null ? "—" : `${summary.settledPct}%`,
      sub: summary.total
        ? `${summary.settled} of ${summary.total} settled without refund`
        : "No archived orders yet",
      icon: CheckCircle2,
      tone: "success",
    },
    {
      key: "eligible",
      label: "Restore Eligible",
      value: String(summary.eligible),
      unit: "orders",
      sub: "Completed orders · window set in Settings",
      icon: History,
      tone: "warning",
    },
  ];

  const empty = orders.length === 0;

  return (
    <div
      className={`admin-archived ${selected ? "" : "admin-archived--no-panel"}`}
    >
      <div className="arc-main">
        <section className="arc-toolbar">
          <SearchBar
            className="arc-toolbar__search"
            placeholder="Search order #, customer, cashier, receipt…"
            aria-label="Search archived orders"
            value={query}
            onChange={(e) => resetPage(setQuery)(e.target.value)}
          />
          <Select
            className="arc-toolbar__select"
            aria-label="Filter by date"
            value={date}
            onChange={(e) => resetPage(setDate)(e.target.value as DatePreset)}
            options={(Object.keys(DATE_LABELS) as DatePreset[]).map((d) => ({
              value: d,
              label: DATE_LABELS[d],
            }))}
          />
          <Select
            className="arc-toolbar__select"
            aria-label="Filter by order type"
            value={type}
            onChange={(e) => resetPage(setType)(e.target.value)}
            options={[
              { value: ALL, label: "Order Type: All" },
              ...Object.entries(TYPE_LABEL).map(([v, l]) => ({
                value: v,
                label: `Order Type: ${l}`,
              })),
            ]}
          />
          <Select
            className="arc-toolbar__select"
            aria-label="Filter by status"
            value={status}
            onChange={(e) => resetPage(setStatus)(e.target.value)}
            options={[
              { value: ALL, label: "Status: All" },
              { value: "completed", label: "Status: Paid" },
              { value: "refunded", label: "Status: Refunded" },
              { value: "partial-refund", label: "Status: Partial Refund" },
            ]}
          />
          <div className="arc-toolbar__right">
            <Button
              icon={<Download size={15} />}
              disabled={filtered.length === 0}
              onClick={exportCsv}
            >
              Export Archive CSV
            </Button>
          </div>
        </section>


        <section className="arc-kpis" aria-label="Archive summary">
          {kpis.map(({ key, label, value, unit, sub, icon: Icon, tone }) => (
            <article
              key={key}
              className={`arc-kpi ${tone ? `arc-kpi--${tone}` : ""}`}
            >
              <div className="arc-kpi__head">
                <span>{label}</span>
                <Icon size={15} />
              </div>
              <strong className="arc-kpi__value">
                {value} {unit && <small>{unit}</small>}
              </strong>
              <p>{sub}</p>
            </article>
          ))}
        </section>

        <section className="arc-card">
          <header className="arc-card__head">
            <h2>Archived Register Records</h2>
            {!empty && (
              <span className="arc-muted">
                Showing {filtered.length} of {orders.length} entries
              </span>
            )}
            <span className="arc-card__sort">
              <CalendarDays size={13} /> Sort: Newest
            </span>
          </header>
          <ArchivedOrdersTable
            orders={rows}
            selectedId={selectedId}
            onSelect={(o) => setSelectedId(o.id)}
            onViewReceipt={(o) => setReceiptId(o.id)}
            onRestore={setRestoring}
            empty={
              loading ? (
                <LoadingState label="Loading archive…" />
              ) : loadError ? (
                <EmptyState title="Could not load the archive" description={loadError} action={<Button onClick={() => void refresh()}>Try again</Button>} />
              ) : empty ? (
                <EmptyState
                  icon={<Archive size={22} />}
                  title="No archived orders yet"
                  description="Completed and archived orders will appear here when they are moved out of the active order workflow."
                />
              ) : (
                <EmptyState
                  icon={<SearchX size={22} />}
                  title="No archived orders match"
                  description="Try a different search, date, order type, or status."
                />
              )
            }
          />
          {!empty && (
            <footer className="arc-footer">
              <span>
                Showing rows{" "}
                {filtered.length ? (current - 1) * PAGE_SIZE + 1 : 0} to{" "}
                {Math.min(current * PAGE_SIZE, filtered.length)} of{" "}
                {filtered.length}
              </span>
              {pageCount > 1 && (
                <Pagination
                  page={current}
                  pageCount={pageCount}
                  onChange={setPage}
                />
              )}
            </footer>
          )}
        </section>

        {review.length > 0 && (
          <section className="arc-card" aria-label="Cancelled orders awaiting review">
            <header className="arc-card__head">
              <h2>Cancelled Orders · Awaiting Review</h2>
              <span className="arc-muted">{review.length} not yet archived</span>
            </header>
            <ul className="arc-review">
              {review.map((o) => (
                <li key={o.id} className="arc-review__row">
                  <strong>#{o.number}</strong>
                  <span className="arc-muted">
                    Cancelled {o.cancelled_at ? new Date(String(o.cancelled_at)).toLocaleString() : ""}
                    {o.cancel_reason ? ` · ${o.cancel_reason}` : ""}
                  </span>
                  <span>{formatPeso(Number(o.totals.total))}</span>
                  <Button
                    size="sm"
                    onClick={() => {
                      setArchiveReason("");
                      setArchiveError(null);
                      setArchiving(o);
                    }}
                  >
                    Archive
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <Modal
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={archiving ? `Archive cancelled order #${archiving.number}?` : ""}
        size="sm"
        footer={
          <>
            <Button onClick={() => setArchiving(null)} disabled={archiveBusy}>
              Keep in Review
            </Button>
            <Button variant="primary" onClick={() => void archiveCancelled()} disabled={archiveBusy}>
              {archiveBusy ? "Archiving…" : "Archive Order"}
            </Button>
          </>
        }
      >
        <p className="arc-muted">The order leaves the review list and is kept in the archive. Nothing is deleted.</p>
        <Input label="Reason" value={archiveReason} maxLength={200} autoFocus onChange={(e) => setArchiveReason(e.target.value)} />
        {archiveError && (
          <div className="api-status api-status--error" role="alert">
            {archiveError}
          </div>
        )}
      </Modal>

      {selected && (
        <ArchivedOrderDetails
          order={selected}
          onClose={() => setSelectedId(null)}
          onViewReceipt={() => setReceiptId(selected.id)}
          onRestore={() => setRestoring(selected)}
        />
      )}

      <Modal
        open={receiptId !== null}
        onClose={() => setReceiptId(null)}
        title={receiptFor ? `Receipt · Order #${receiptFor.orderNumber}` : ""}
        size="sm"
      >
        {!receiptDoc ? (
          <LoadingState label="Loading receipt…" />
        ) : !receiptDoc.document ? (
          <EmptyState title="No sales document" description="This order has no issued document (for example, it was cancelled before settlement)." />
        ) : (
          <div className="arc-receipt">
            <ReceiptPreview receipt={receiptDoc.receipt} business={businessInfo(receiptDoc.document)} />
            <ReceiptPrinter
              receipt={receiptDoc.receipt}
              variant="footer"
              onFeedback={setFeedback}
              onPrinted={async (r) => {
                if (!r.documentId) return;
                const doc = await printDocument(r.documentId);
                setReceiptDoc((cur) => (cur ? { ...cur, receipt: { ...cur.receipt, printCount: doc.print_count }, document: doc } : cur));
              }}
            />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={restoring !== null}
        title="Restore archived order?"
        message={
          restoring &&
          `Order #${restoring.orderNumber} (${formatPeso(receiptTotals(restoring).total)}) will be taken out of the archive and returned to History. The server only allows this within the configured restore window.`
        }
        confirmLabel="Restore Order"
        onConfirm={() => void confirmRestore()}
        onCancel={() => setRestoring(null)}
      />
      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}
