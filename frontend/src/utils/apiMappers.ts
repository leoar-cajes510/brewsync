import type { Order, OrderType } from '../types/order';
import type { PaymentMethod } from '../types/payment';
import type { BusinessInfo, Receipt, ReceiptStatus, Transaction } from '../types/receipt';
import type { DocumentDto, HistoryOrderDto, OrderDto, OrderTypeDto, PaymentMethodDto } from '../types/api';

// Adapters between API DTOs and the existing UI view types, so the completed screens
// render server data without being redesigned. Amounts are the server's values.

export const toApiMethod = (m: PaymentMethod): PaymentMethodDto => (m === 'bank-transfer' ? 'bank_transfer' : m);
export const fromApiMethod = (m: PaymentMethodDto): PaymentMethod => (m === 'bank_transfer' ? 'bank-transfer' : m);

export const toApiOrderType = (t: OrderType): OrderTypeDto => (t === 'dine-in' ? 'dine_in' : t);
export const fromApiOrderType = (t: OrderTypeDto): OrderType => (t === 'dine_in' ? 'dine-in' : t);

const money = (v: string | null | undefined) => (v ? Number(v) : 0);

function choiceLabel(c: { group: string; option: string; price_delta: string }) {
  return Number(c.price_delta) > 0 ? `${c.option} (+₱${Number(c.price_delta).toFixed(2)})` : c.option;
}

/** Active orders board card/detail view. */
export function orderView(o: OrderDto): Order {
  const completed = o.payments.filter((p) => p.status === 'completed');
  const last = completed[completed.length - 1];
  return {
    id: o.id,
    number: o.number,
    customer: 'Walk-in',
    type: fromApiOrderType(o.order_type),
    tag: o.tag ?? undefined,
    cashier: o.cashier_name ?? '—',
    status: o.status === 'preparing' || o.status === 'ready' ? o.status : 'pending',
    placedAt: new Date(o.created_at),
    items: o.items.map((i) => ({
      id: i.id,
      name: i.product_name,
      quantity: i.quantity,
      unitPrice: money(i.unit_price),
      choices: i.choices.map(choiceLabel),
    })),
    discount: money(o.totals.discount_total),
    note: o.note ?? undefined,
    payment: {
      status: o.payment_status === 'paid' ? 'paid' : 'unpaid',
      method: last ? fromApiMethod(last.method) : undefined,
      reference: last?.reference ?? undefined,
    },
    totals: {
      subtotal: money(o.totals.subtotal),
      discount: money(o.totals.discount_total),
      tax: money(o.totals.tax_amount),
      total: money(o.totals.total),
      amountDue: money(o.amount_due),
      paid: completed.reduce((sum, p) => sum + money(p.amount), 0),
    },
    pendingPayments: o.payments
      .filter((p) => p.status === 'pending')
      .map((p) => ({ id: p.id, method: p.method, amount: money(p.amount), reference: p.reference ?? undefined })),
  };
}

function receiptStatus(o: OrderDto): ReceiptStatus {
  if (o.refund_status === 'refunded') return 'refunded';
  if (o.refund_status === 'partially_refunded') return 'partial-refund';
  return 'completed';
}

/** A completed order with its issued document, as shown in History and Receipts. */
export function transactionView(o: HistoryOrderDto, document?: DocumentDto | null): Transaction {
  const completed = o.payments.filter((p) => p.status === 'completed');
  const first = completed[0];
  const snapshot = document?.snapshot;
  return {
    id: o.id,
    number: o.document?.number ?? document?.number ?? '—',
    orderNumber: o.number,
    transactionNumber: o.document?.number ?? o.number,
    customer: 'Walk-in',
    orderType: fromApiOrderType(o.order_type),
    tag: o.tag ?? undefined,
    issuedAt: new Date(document?.issued_at ?? o.completed_at ?? o.created_at),
    terminal: snapshot?.terminal ?? '—',
    till: snapshot?.terminal ?? '—',
    cashier: snapshot?.cashier ?? '—',
    items: o.items.map((i) => ({
      name: i.product_name,
      quantity: i.quantity,
      // Item unit price already includes choice surcharges (server snapshot).
      unitPrice: money(i.unit_price),
      modifiers: i.choices.map((c) => ({ label: `${c.group}: ${c.option}` })),
    })),
    discount: money(o.totals.discount_total),
    discountLabel: o.discount?.name,
    payment: {
      method: first ? fromApiMethod(first.method) : 'cash',
      label: completed.length > 1 ? `Split (${completed.length} payments)` : undefined,
      reference: first?.reference ?? undefined,
      // Amount handed over: cash tendered (or the amount) summed over every payment.
      tendered: completed.length ? completed.reduce((sum, p) => sum + money(p.tendered ?? p.amount), 0) : undefined,
    },
    status: receiptStatus(o),
    refundedAmount: o.refunds.reduce((sum, r) => sum + money(r.amount), 0) || undefined,
    display: (snapshot?.display ?? undefined) as Transaction['display'],
    printCount: document?.print_count ?? 0,
    documentId: o.document?.id ?? document?.id,
    serverTotals: {
      subtotal: money(o.totals.subtotal),
      discount: money(o.totals.discount_total),
      tax: money(o.totals.tax_amount),
      total: money(o.totals.total),
      taxLabel: snapshot?.totals.tax_name || 'Tax',
      change: completed.reduce((sum, p) => sum + money(p.change_given), 0),
      paid: completed.reduce((sum, p) => sum + money(p.amount), 0),
    },
    payments: completed.map((p) => ({
      method: fromApiMethod(p.method),
      amount: money(p.amount),
      reference: p.reference ?? undefined,
      tendered: p.tendered ? money(p.tendered) : undefined,
      change: p.change_given ? money(p.change_given) : undefined,
    })),
  };
}

/** A document (Receipts page) rendered from its immutable snapshot. */
export function receiptFromDocument(d: DocumentDto): Receipt {
  const s = d.snapshot;
  const first = s.payments[0];
  return {
    id: d.id,
    number: d.number,
    orderNumber: s.order.number,
    customer: 'Walk-in',
    orderType: fromApiOrderType(s.order.type),
    tag: s.order.tag ?? undefined,
    issuedAt: new Date(d.issued_at),
    terminal: s.terminal ?? '—',
    cashier: s.cashier,
    items: s.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPrice: money(i.unit_price),
      modifiers: i.choices.map((c) => ({ label: `${c.group}: ${c.option}` })),
    })),
    discount: money(s.totals.discount_total),
    discountLabel: s.discount?.name,
    payment: {
      method: first ? fromApiMethod(first.method) : 'cash',
      label: s.payments.length > 1 ? `Split (${s.payments.length} payments)` : undefined,
      reference: first?.reference ?? undefined,
      tendered: s.payments.length === 1 && first?.tendered ? money(first.tendered) : undefined,
    },
    // Document statuses: issued / partially_refunded / refunded / void (refunds mark the document).
    status: d.status === 'refunded' ? 'refunded' : d.status === 'partially_refunded' ? 'partial-refund' : 'completed',
    printCount: d.print_count,
    documentId: d.id,
    serverTotals: {
      subtotal: money(s.totals.subtotal),
      discount: money(s.totals.discount_total),
      tax: money(s.totals.tax_amount),
      total: money(s.totals.total),
      taxLabel: s.totals.tax_name || 'Tax',
      change: s.payments.reduce((sum, p) => sum + money(p.change), 0),
      paid: s.payments.reduce((sum, p) => sum + money(p.amount), 0),
    },
    payments: s.payments.map((p) => ({
      method: fromApiMethod(p.method),
      amount: money(p.amount),
      reference: p.reference ?? undefined,
      tendered: p.tendered ? money(p.tendered) : undefined,
      change: p.change ? money(p.change) : undefined,
    })),
    display: (s.display ?? undefined) as Receipt['display'],
    business: {
      name: s.business.name,
      address: s.business.address,
      phone: s.business.phone,
      title: s.document_title,
    },
  };
}

/** Receipt header from the document snapshot (no invented tax ID or footer text). */
export function businessInfo(d: DocumentDto | null | undefined): BusinessInfo {
  const s = d?.snapshot;
  return {
    name: s?.business.name ?? '',
    terminalLine: s?.terminal ? `Terminal ${s.terminal}` : '',
    tin: '',
    address: s?.business.address ?? '',
    phone: s?.business.phone ?? '',
    thankYou: (s?.display?.thankYou as string | undefined) || (s?.document_title ?? ''),
    footer: (s?.display?.footer as string | undefined) ?? '',
  };
}
