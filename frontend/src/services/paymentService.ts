import { api } from './api';
import type { OrderDto, PaymentMethodDto, PaymentResultDto } from '../types/api';

export interface PaymentInput {
  method: PaymentMethodDto;
  /** Requested amount; validated by the server against the remaining balance. */
  amount: string;
  tendered?: string;
  reference?: string;
}

export const recordPayment = (orderId: string, input: PaymentInput, idempotencyKey: string) =>
  api.post<PaymentResultDto>(`/orders/${orderId}/payments`, input, idempotencyKey);

/** Confirm or void a payment awaiting confirmation (✱pos.processPayments). Completed payments are
 *  never edited; they are reversed only through a refund. */
export const confirmPayment = (orderId: string, paymentId: string) => api.post<OrderDto>(`/orders/${orderId}/payments/${paymentId}/confirm`, {});
export const voidPayment = (orderId: string, paymentId: string) => api.post<OrderDto>(`/orders/${orderId}/payments/${paymentId}/void`, {});
