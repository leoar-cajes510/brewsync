import type { OrderType } from './order';
import type { PaymentMethod } from './payment';

export type ReceiptStatus = 'completed' | 'refunded' | 'partial-refund';

export interface ReceiptModifier {
  label: string;
  /** per-unit add-on price, if any */
  price?: number;
}

export interface ReceiptItem {
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers: ReceiptModifier[];
}

export interface ReceiptPayment {
  method: PaymentMethod;
  /** e.g. "Visa ··· 4821" for cards */
  label?: string;
  reference?: string;
  tendered?: number;
}

export interface Receipt {
  id: string;
  number: string;
  orderNumber: string;
  customer: string;
  orderType: OrderType;
  tag?: string;
  issuedAt: Date;
  terminal: string;
  cashier: string;
  items: ReceiptItem[];
  discount: number;
  discountLabel?: string;
  payment: ReceiptPayment;
  status: ReceiptStatus;
  refundedAmount?: number;
  printCount: number;
  /** Issued document id (API); print/reprint goes through it. */
  documentId?: string;
  /** Server/snapshot totals; display helpers prefer these over any local computation. */
  serverTotals?: { subtotal: number; discount: number; tax: number; total: number; taxLabel: string; change: number; paid: number };
  /** Every completed payment (split payments). */
  payments?: { method: PaymentMethod; amount: number; reference?: string; tendered?: number; change?: number }[];
  /** Business block from the document snapshot. */
  business?: { name: string; address: string; phone: string; title: string | null };
  /** Settings → Receipts display options frozen into the document at issue (null = defaults). */
  display?: ReceiptDisplay;
}

/** Display-only receipt options (Settings → Receipts); a missing toggle means "show". */
export interface ReceiptDisplay {
  heading?: string;
  thankYou?: string;
  footer?: string;
  smallPrint?: string;
  showBusinessName?: boolean;
  showAddress?: boolean;
  showPhone?: boolean;
  showOrderNumber?: boolean;
  showDateTime?: boolean;
  showCashier?: boolean;
  showTerminal?: boolean;
  showTax?: boolean;
  showDiscount?: boolean;
  showPaymentMethod?: boolean;
  showReference?: boolean;
}

/** A completed sale as shown in History (same shape as its receipt, plus audit info). */
export interface Transaction extends Receipt {
  transactionNumber: string;
  till: string;
}

export interface BusinessInfo {
  name: string;
  terminalLine: string;
  tin: string;
  address: string;
  phone: string;
  thankYou: string;
  footer: string;
}
