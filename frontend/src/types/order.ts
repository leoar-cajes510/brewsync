import type { ChoiceOption } from './product';
import type { PaymentMethod } from './payment';

export type OrderType = 'dine-in' | 'takeout' | 'delivery';

export interface SelectedChoice extends ChoiceOption {
  groupId: string;
}

export type OrderStatus = 'pending' | 'preparing' | 'ready';

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  choices: string[];
}

export interface OrderPayment {
  status: 'paid' | 'unpaid';
  method?: PaymentMethod;
  reference?: string;
}

export interface Order {
  id: string;
  number: string;
  customer: string;
  type: OrderType;
  /** table for dine-in, delivery ref for delivery */
  tag?: string;
  cashier: string;
  status: OrderStatus;
  placedAt: Date;
  startedAt?: Date;
  readyAt?: Date;
  items: OrderItem[];
  discount: number;
  note?: string;
  payment: OrderPayment;
  /** Server-computed totals (API orders); display helpers prefer these. */
  totals?: { subtotal: number; discount: number; tax: number; total: number; amountDue: number; paid: number };
  /** Payments awaiting staff confirmation (payment method set to "Require payment confirmation"). */
  pendingPayments?: { id: string; method: string; amount: number; reference?: string }[];
}

export interface CartLine {
  /** product id + selected option ids, so different customizations stay separate lines */
  key: string;
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  choices: SelectedChoice[];
}
