import type { Receipt } from '../types/receipt';
import { receiptPaymentLabel, receiptTotals } from './receipt';

// CSV export of rows already on screen (no server round trip). Values that a spreadsheet would run
// as a formula (=, +, -, @, tab, CR) are prefixed with an apostrophe — names are user-entered.

export type CsvCell = string | number | boolean | null | undefined | Date;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, header: string[], rows: CsvCell[][]): void {
  // BOM so spreadsheet apps read UTF-8 (₱, accented names) correctly.
  const blob = new Blob(['﻿', toCsv(header, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const isoDate = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;


/** History / Receipts export: one row per transaction, using the same totals the screens show. */
export function exportReceipts(filename: string, list: Receipt[]): void {
  downloadCsv(
    filename,
    ['Order #', 'Receipt #', 'Issued', 'Customer', 'Order Type', 'Cashier', 'Terminal', 'Items', 'Subtotal', 'Discount', 'Tax', 'Total', 'Refunded', 'Payment', 'Status'],
    list.map((r) => {
      const t = receiptTotals(r);
      return [
        r.orderNumber, r.number, r.issuedAt, r.customer, r.orderType, r.cashier, r.terminal,
        r.items.map((i) => `${i.quantity}× ${i.name}`).join('; '),
        t.subtotal.toFixed(2), t.discount.toFixed(2), t.vat.toFixed(2), t.total.toFixed(2),
        (r.refundedAmount ?? 0).toFixed(2), receiptPaymentLabel(r.payment), r.status,
      ];
    }),
  );
}
