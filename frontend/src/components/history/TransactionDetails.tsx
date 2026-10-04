import { useState } from 'react';
import { CheckCircle2, ChefHat, Printer, RotateCcw, Share2, X } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import ReceiptPreview from '../receipts/ReceiptPreview';
import RefundDialog from './RefundDialog';
import { useFeatureSettings } from '../../stores/featureSettingsStore';
import { can, useAuth } from '../../stores/authStore';
import { transactionStatus } from './TransactionTable';
import type { BusinessInfo, Transaction } from '../../types/receipt';
import { formatPeso } from '../../utils/currency';
import { receiptPaymentLabel, receiptTotals } from '../../utils/receipt';
import '../receipts/receipts.css';

interface TransactionDetailsProps {
  transaction: Transaction;
  business: BusinessInfo;
  onClose: () => void;
  /** Records a print/reprint of the issued document (POST /documents/{id}/reprint). */
  onReprint: (t: Transaction) => Promise<void>;
  onFeedback: (message: string) => void;
  /** Full refund (POST /orders/{id}/refunds); rejects with the server error. */
  onRefund: (t: Transaction, reason: string, idempotencyKey: string) => Promise<void>;
}

const typeLabel = { 'dine-in': 'Dine-In', takeout: 'Takeout', delivery: 'Delivery' } as const;

export default function TransactionDetails({ transaction: t, business, onClose, onReprint, onFeedback, onRefund }: TransactionDetailsProps) {
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const { flags } = useFeatureSettings();
  const { user } = useAuth();
  const mayRefund = can(user, 'pos.processRefunds');
  const totals = receiptTotals(t);
  const refundable = Math.max(totals.total - (t.refundedAmount ?? 0), 0);
  const status = transactionStatus[t.status];
  const dining = `${typeLabel[t.orderType]}${t.tag ? ` · ${t.tag.replace('Table ', '')}` : ''}`;

  const share = async () => {
    try {
      await navigator.clipboard.writeText(t.payment.reference ?? t.transactionNumber);
      onFeedback(`Copied ${t.payment.reference ?? t.transactionNumber}`);
    } catch {
      onFeedback(`Reference: ${t.payment.reference ?? t.transactionNumber}`);
    }
  };

  return (
    <>
      <header className="txn-panel__header">
        <h2 className="txn-panel__title">Transaction #{t.orderNumber}</h2>
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
        <div className="txn-panel__tools">
          <button type="button" className="icon-btn" aria-label="View receipt" title="View receipt" onClick={() => setReceiptOpen(true)}>
            <Printer size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label="Copy reference" title="Copy reference" onClick={share}>
            <Share2 size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label="Close details" title="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="txn-panel__body">
        <dl className="txn-summary">
          <div>
            <dt>Order &amp; Receipt</dt>
            <dd>
              #{t.orderNumber} · {t.number}
            </dd>
          </div>
          <div>
            <dt>Date &amp; Time</dt>
            <dd>
              {t.issuedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} ·{' '}
              {t.issuedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </dd>
          </div>
          <div>
            <dt>Customer &amp; Dining</dt>
            <dd>
              {t.customer} ({dining})
            </dd>
          </div>
          <div>
            <dt>Station / Staff</dt>
            <dd>
              {t.cashier.replace(')', `, ${t.till})`)} · {t.terminal}
            </dd>
          </div>
        </dl>

        <div className="txn-section-head">
          <span>Itemized Order</span>
          <span>
            {totals.quantity} {totals.quantity === 1 ? 'item' : 'items'}
          </span>
        </div>

        <div className="txn-items">
          {t.items.map((item, i) => (
            <div key={i} className="txn-item">
              <span className="txn-item__qty">{item.quantity}×</span>
              <div className="txn-item__main">
                <div className="txn-item__row">
                  <strong>{item.name}</strong>
                  <strong>{formatPeso(item.unitPrice * item.quantity)}</strong>
                </div>
                <span className="txn-item__each">{formatPeso(item.unitPrice)} each</span>
                {item.modifiers.length > 0 && (
                  <div className="txn-item__mods">
                    {item.modifiers.map((m) => (
                      <span key={m.label} className="txn-chip">
                        {m.label}
                        {m.price ? ` (+${formatPeso(m.price)})` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="txn-totals">
          <div className="txn-totals__row">
            <span>Subtotal</span>
            <span>{formatPeso(totals.subtotal)}</span>
          </div>
          <div className="txn-totals__row">
            <span>Net Amount</span>
            <span>{formatPeso(totals.vatableSales)}</span>
          </div>
          <div className="txn-totals__row">
            <span>{totals.taxLabel}</span>
            <span>{formatPeso(totals.vat)}</span>
          </div>
          <div className="txn-totals__row">
            <span>Discounts{t.discountLabel ? ` (${t.discountLabel})` : ''}</span>
            <span>{totals.discount ? `−${formatPeso(totals.discount)}` : formatPeso(0)}</span>
          </div>
          <div className="txn-totals__total">
            <span>Total Charged</span>
            <span>{formatPeso(totals.total)}</span>
          </div>
          {t.refundedAmount ? (
            <div className="txn-totals__row txn-totals__row--refund">
              <span>Refunded</span>
              <span>−{formatPeso(t.refundedAmount)}</span>
            </div>
          ) : null}
        </div>

        <section className="txn-audit">
          <h3>
            <CheckCircle2 size={15} /> Payment Audit Record
          </h3>
          <dl>
            <div>
              <dt>Method</dt>
              <dd>{receiptPaymentLabel(t.payment)}</dd>
            </div>
            <div>
              <dt>Tendered / Change</dt>
              <dd>
                {formatPeso(t.payment.tendered ?? totals.total)} / {formatPeso(Math.max(totals.change, 0))}
              </dd>
            </div>
            <div>
              <dt>Till Drawer</dt>
              <dd>{t.payment.method === 'cash' ? `${t.till} (Verified Float)` : `${t.till} (Non-cash)`}</dd>
            </div>
            <div>
              <dt>Reference No.</dt>
              <dd className="txn-mono">{t.payment.reference ?? '—'}</dd>
            </div>
          </dl>
        </section>
      </div>

      <footer className="txn-panel__footer">
        <div className="txn-panel__actions">
          <Button icon={<Printer size={15} />} onClick={() => setReceiptOpen(true)}>
            View Receipt
          </Button>
          <Button icon={<ChefHat size={15} />} disabled title="Available in a later phase">
            Kitchen Ticket
          </Button>
        </div>
        <Button
          className="txn-refund-btn"
          block
          icon={<RotateCcw size={15} />}
          disabled={t.status === 'refunded' || !flags.refunds || !mayRefund}
          title={!flags.refunds ? 'Refunds are turned off in Settings → Features' : !mayRefund ? 'Your role cannot process refunds' : undefined}
          onClick={() => setRefunding(true)}
        >
          {t.status === 'refunded' ? 'Transaction Refunded' : flags.refunds ? 'Refund Transaction' : 'Refunds Turned Off'}
        </Button>
      </footer>

      <Modal
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        title={`Receipt · ${t.number}`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setReceiptOpen(false)}>Close</Button>
            <Button
              variant="primary"
              icon={<Printer size={15} />}
              disabled={!t.documentId || printing}
              onClick={async () => {
                setPrinting(true);
                await onReprint(t);
                setPrinting(false);
                setReceiptOpen(false);
              }}
            >
              {printing ? 'Recording…' : t.printCount > 0 ? 'Reprint Receipt' : 'Print Receipt'}
            </Button>
          </>
        }
      >
        <div className="txn-receipt-modal">
          <ReceiptPreview receipt={t} business={business} />
        </div>
      </Modal>

      <RefundDialog transaction={refunding ? t : null} amount={refundable} onClose={() => setRefunding(false)} onRefund={onRefund} />
    </>
  );
}
