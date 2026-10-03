import type { BusinessInfo, Receipt } from '../../types/receipt';
import { formatPeso } from '../../utils/currency';
import { orderTypeLabel } from '../../utils/orderDisplay';
import { receiptCode, receiptPaymentLabel, receiptTotals } from '../../utils/receipt';

interface ReceiptPreviewProps {
  receipt: Receipt;
  business: BusinessInfo;
}

/** Decorative barcode derived from the receipt code (not a scannable symbology). */
function Barcode({ value }: { value: string }) {
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    for (let bit = 0; bit < 4; bit++) {
      const w = ((code >> bit) & 1) + 1;
      if (bit % 2 === 0) bars.push({ x, w });
      x += w + 1;
    }
  }
  return (
    <svg className="barcode" viewBox={`0 0 ${x} 40`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={40} />
      ))}
    </svg>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'success' | 'danger' }) {
  return (
    <div className={`paper-row ${strong ? 'paper-row--strong' : ''} ${tone ? `paper-row--${tone}` : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;

// Thermal-style receipt paper (UI preview only).
export default function ReceiptPreview({ receipt, business }: ReceiptPreviewProps) {
  const t = receiptTotals(receipt);
  const code = receiptCode(receipt);
  const { payment } = receipt;
  // Settings → Receipts snapshot (display only); a toggle that is not set means "show".
  const show = (key: keyof NonNullable<typeof receipt.display>) => receipt.display?.[key] !== false;
  const heading = receipt.display?.heading?.trim();
  const smallPrint = receipt.display?.smallPrint?.trim();

  return (
    <article className={`paper ${receipt.status === 'refunded' ? 'paper--void' : ''}`} aria-label={`Receipt ${receipt.number}`}>
      {receipt.status === 'refunded' && <span className="paper__stamp">Refunded</span>}

      <header className="paper__business">
        {show('showBusinessName') && <strong>{business.name.toUpperCase()}</strong>}
        {show('showTerminal') && <span>{business.terminalLine}</span>}
        <span>{business.tin}</span>
        {show('showAddress') && <span>{business.address}</span>}
        {show('showPhone') && <span>{business.phone}</span>}
        {heading && <strong className="paper__heading">{heading}</strong>}
      </header>

      <hr />
      <Row label="Receipt #:" value={receipt.number} />
      {show('showOrderNumber') && <Row label="Order #:" value={`#${receipt.orderNumber} (${orderTypeLabel({ type: receipt.orderType, tag: receipt.tag })})`} />}
      {show('showDateTime') && <Row label="Date / Time:" value={fmtDate(receipt.issuedAt)} />}
      {show('showCashier') && <Row label="Cashier:" value={receipt.cashier} />}
      {show('showTerminal') && <Row label="Terminal:" value={receipt.terminal} />}
      <hr />

      <div className="paper__items">
        {receipt.items.map((item, i) => (
          <div key={i} className="paper-item">
            <div className="paper-row paper-row--strong">
              <span>
                {item.quantity} × {item.name} @ {formatPeso(item.unitPrice)}
              </span>
              <span>{formatPeso(item.unitPrice * item.quantity)}</span>
            </div>
            {item.modifiers.map((m) =>
              m.price ? (
                <div key={m.label} className="paper-row paper-row--mod">
                  <span>
                    + {m.label} ({item.quantity} × {formatPeso(m.price)})
                  </span>
                  <span>{formatPeso(m.price * item.quantity)}</span>
                </div>
              ) : (
                <div key={m.label} className="paper-row paper-row--mod">
                  <span>- {m.label}</span>
                </div>
              ),
            )}
          </div>
        ))}
      </div>

      <hr />
      <Row label={`Items Subtotal (${t.itemCount} items, ${t.quantity} qty)`} value={formatPeso(t.subtotal)} />
      <Row label="Net Amount" value={formatPeso(t.vatableSales)} />
      {show('showTax') && <Row label={t.taxLabel} value={formatPeso(t.vat)} />}
      {show('showDiscount') && <Row label={`Discount (${receipt.discountLabel ?? 'None'})`} value={t.discount ? `−${formatPeso(t.discount)}` : formatPeso(0)} />}
      <hr className="paper__rule--double" />
      <Row label="TOTAL CHARGED" value={formatPeso(t.total)} strong />
      {receipt.refundedAmount ? <Row label="Refunded" value={`−${formatPeso(receipt.refundedAmount)}`} tone="danger" /> : null}
      <hr />

      {receipt.payments && receipt.payments.length > 1 ? (
        receipt.payments.map((p, i) => (
          <Row key={i} label={`${show('showPaymentMethod') ? receiptPaymentLabel({ method: p.method }) : 'Payment'}${p.reference && show('showReference') ? ` (${p.reference})` : ''}`} value={formatPeso(p.amount)} />
        ))
      ) : (
        <>
          {show('showPaymentMethod') && <Row label="Payment Method:" value={receiptPaymentLabel(payment)} />}
          {payment.reference && show('showReference') && <Row label="Reference:" value={payment.reference} />}
          <Row label="Amount Received:" value={formatPeso(payment.tendered ?? t.total)} />
        </>
      )}
      <Row label="Change Given:" value={formatPeso(Math.max(t.change, 0))} tone="success" />

      <div className="paper__barcode">
        <Barcode value={code} />
        <span>* {code} *</span>
      </div>

      <footer className="paper__footer">
        <strong>{business.thankYou}</strong>
        <span>{business.footer}</span>
        {smallPrint && <small>{smallPrint}</small>}
        {receipt.printCount > 1 && <span>** REPRINT #{receipt.printCount - 1} **</span>}
      </footer>
    </article>
  );
}
