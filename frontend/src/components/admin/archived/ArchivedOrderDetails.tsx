import { Archive, Clock, History, MonitorSmartphone, ReceiptText, StickyNote, User, X } from 'lucide-react';
import Badge from '../../ui/Badge';
import Button from '../../ui/Button';
import { formatPeso } from '../../../utils/currency';
import { lineTotal, receiptPaymentLabel, receiptTotals } from '../../../utils/receipt';
import { ArchiveBadge, STATUS, TYPE_LABEL, shortDate, shortTime } from './ArchivedOrdersTable';
import { canRestore, type ArchivedOrder } from './archivedData';

interface ArchivedOrderDetailsProps {
  order: ArchivedOrder;
  onClose: () => void;
  onViewReceipt: () => void;
  onRestore: () => void;
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'neg' | 'pos' }) {
  return (
    <div className={`arc-row ${strong ? 'arc-row--strong' : ''} ${tone ? `arc-row--${tone}` : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

// Read-only details of one archived order. Restore is a protected action that
// the page confirms before applying (restore is performed by the server).
export default function ArchivedOrderDetails({ order: o, onClose, onViewReceipt, onRestore }: ArchivedOrderDetailsProps) {
  const t = receiptTotals(o);
  const eligible = canRestore(o);
  const paid = o.status !== 'refunded';

  return (
    <aside className="arc-panel" aria-label={`Archived order #${o.orderNumber}`}>
      <header className="arc-panel__header">
        <span className="arc-panel__icon">
          <Archive size={16} />
        </span>
        <div className="arc-panel__title">
          <h2>Archived Order #{o.orderNumber}</h2>
          <div>
            <ArchiveBadge order={o} />
            <span className="arc-muted"> · {o.status === 'completed' ? 'Completed' : STATUS[o.status].label}</span>
          </div>
        </div>
        <button type="button" className="icon-btn" aria-label="Close details" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <div className="arc-panel__body">
        <div className="arc-facts">
          <div className="arc-fact">
            <Clock size={14} />
            <span>Placed &amp; Archived</span>
            <div>
              <strong>
                {shortDate(o.issuedAt)} · {shortTime(o.issuedAt)}
              </strong>
              <em>
                Archived {shortDate(o.archivedAt)}, {shortTime(o.archivedAt)} ({o.archivedBy})
              </em>
            </div>
          </div>
          <div className="arc-fact">
            <MonitorSmartphone size={14} />
            <span>Terminal &amp; Cashier</span>
            <div>
              <strong>{o.terminal}</strong>
              <em>Recorded by {o.cashier}</em>
            </div>
          </div>
          <div className="arc-fact">
            <User size={14} />
            <span>Customer &amp; Type</span>
            <div>
              <strong>{o.customer}</strong>
              <em>
                {TYPE_LABEL[o.orderType]}
                {o.tag ? ` · ${o.tag}` : ''}
              </em>
            </div>
          </div>
        </div>

        <section>
          <div className="arc-section-head">
            <h3>
              Itemized Bill ({t.itemCount} product{t.itemCount === 1 ? '' : 's'} · {t.quantity} unit{t.quantity === 1 ? '' : 's'})
            </h3>
          </div>
          <ul className="arc-items">
            {o.items.map((i, k) => (
              <li key={k}>
                <span className="arc-items__qty">{i.quantity}×</span>
                <div>
                  <strong>{i.name}</strong>
                  {i.modifiers.length > 0 && <em>{i.modifiers.map((m) => (m.price ? `${m.label} (+${formatPeso(m.price)})` : m.label)).join(', ')}</em>}
                </div>
                <strong>{formatPeso(lineTotal(i))}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className="arc-totals">
          <Row label="Subtotal" value={formatPeso(t.subtotal)} />
          <Row label={o.discountLabel ? `Discount · ${o.discountLabel}` : 'Discount'} value={t.discount ? `−${formatPeso(t.discount)}` : formatPeso(0)} tone={t.discount ? 'neg' : undefined} />
          <Row label="VAT (12%, included)" value={formatPeso(t.vat)} />
          <Row label="Total" value={formatPeso(t.total)} strong />
          {o.refundedAmount ? <Row label="Refunded" value={`−${formatPeso(o.refundedAmount)}`} tone="neg" /> : null}
        </section>

        <section className="arc-payment">
          <h3>Payment</h3>
          <Row label="Method" value={receiptPaymentLabel(o.payment)} />
          <Row label="Reference" value={o.payment.reference ?? '—'} />
          <div className="arc-row">
            <span>Status</span>
            <Badge tone={STATUS[o.status].tone} dot>
              {paid ? STATUS[o.status].label : 'Refunded'}
            </Badge>
          </div>
          {o.payment.tendered !== undefined && (
            <>
              <Row label="Amount Received" value={formatPeso(o.payment.tendered)} />
              <Row label="Change" value={formatPeso(t.change)} />
            </>
          )}
        </section>

        {o.note && (
          <p className="arc-note">
            <StickyNote size={13} /> {o.note}
          </p>
        )}
      </div>

      <footer className="arc-panel__footer">
        <Button icon={<ReceiptText size={15} />} onClick={onViewReceipt}>
          View Receipt
        </Button>
        <Button className="arc-restore-btn" icon={<History size={15} />} disabled={!eligible} onClick={onRestore}>
          Restore Order
        </Button>
        {!eligible && (
          <span className="arc-panel__hint">
            Only completed orders can be restored.
          </span>
        )}
      </footer>
    </aside>
  );
}
