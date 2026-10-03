import type { PaymentMethod } from '../types/payment';
import type { Receipt } from '../types/receipt';

// Display helpers for Receipts/History. Totals come from the server or the document
// snapshot (serverTotals); nothing tax-related is computed here.

export interface ReceiptTotals {
  itemCount: number;
  quantity: number;
  subtotal: number;
  discount: number;
  total: number;
  vatableSales: number;
  vat: number;
  change: number;
  taxLabel: string;
}

export function lineTotal(item: Receipt['items'][number]): number {
  const addOns = item.modifiers.reduce((sum, m) => sum + (m.price ?? 0), 0);
  return (item.unitPrice + addOns) * item.quantity;
}

export function receiptTotals(receipt: Receipt): ReceiptTotals {
  const itemCount = receipt.items.length;
  const quantity = receipt.items.reduce((sum, i) => sum + i.quantity, 0);
  const t = receipt.serverTotals;
  if (t) {
    return {
      itemCount, quantity, subtotal: t.subtotal, discount: t.discount, total: t.total,
      vatableSales: t.total - t.tax, vat: t.tax, change: t.change, taxLabel: t.taxLabel,
    };
  }
  const subtotal = receipt.items.reduce((sum, i) => sum + lineTotal(i), 0);
  const total = subtotal - receipt.discount;
  return {
    itemCount, quantity, subtotal, discount: receipt.discount, total,
    vatableSales: total, vat: 0,
    change: receipt.payment.tendered ? receipt.payment.tendered - total : 0,
    taxLabel: 'Tax',
  };
}

const methodLabels: Record<PaymentMethod, string> = {
  cash: 'Cash',
  gcash: 'GCash / QRPh',
  card: 'Card',
  'bank-transfer': 'Bank Transfer',
};

export function receiptPaymentLabel(payment: Receipt['payment']): string {
  return payment.label ?? methodLabels[payment.method];
}

/** Reference printed under the barcode, e.g. BS-1042-20240924-01 */
export function receiptCode(receipt: Receipt): string {
  const d = receipt.issuedAt;
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `BS-${receipt.orderNumber}-${ymd}-${receipt.terminal.replace(/\D/g, '').padStart(2, '0')}`;
}

export function isToday(date: Date, now = new Date()): boolean {
  return date.toDateString() === now.toDateString();
}
