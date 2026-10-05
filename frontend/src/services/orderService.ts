import { api, newIdempotencyKey } from './api';
import type { HistoryDetailDto, HistoryOrderDto, OrderDto, OrderStatusDto, OrderTypeDto, QuoteDto } from '../types/api';

export interface OrderLineInput {
  product_id: string;
  quantity: number;
  /** choice group id → selected option ids */
  selections?: Record<string, string[]>;
}

export interface OrderInput {
  order_type: OrderTypeDto;
  lines: OrderLineInput[];
  discount?: { discount_id: string; identification?: Record<string, string> };
  tag?: string;
  note?: string;
  /** The total the cashier saw; the server refuses a stale cart (409 CART_STALE). */
  expected_total?: string;
}

/** Server-authoritative totals preview; nothing is created or reserved. */
export const quote = (input: OrderInput) => api.post<QuoteDto>('/orders/quote', input);

/** The caller keeps the key so a retry of the same submission is replayed, never duplicated. */
export const createOrder = (input: OrderInput, idempotencyKey: string) => api.post<OrderDto>('/orders', input, idempotencyKey);

/** After a timeout: was the order sent with this key created? Waits for an in-flight request, so
 *  "not_created" is conclusive. */
export const submissionStatus = (idempotencyKey: string) =>
  api.get<{ status: 'created' | 'not_created'; order?: OrderDto }>(`/orders/submissions/${encodeURIComponent(idempotencyKey)}`);

export const listActiveOrders = (background = false) =>
  (background ? api.poll : api.get)<OrderDto[]>('/orders?status=pending,preparing,ready');
export const getOrder = (id: string) => api.get<OrderDto>(`/orders/${id}`);

export const changeStatus = (order: Pick<OrderDto, 'id' | 'version'>, target: OrderStatusDto) =>
  api.post<OrderDto>(`/orders/${order.id}/status`, { target, expected_version: order.version }, newIdempotencyKey());

export const history = () => api.get<HistoryOrderDto[]>('/history');
export const historyDetail = (id: string) => api.get<HistoryDetailDto>(`/history/${id}`);

/** Non-archived orders in the given statuses. */
export const listOrders = (statuses: OrderStatusDto[]) => api.get<OrderDto[]>(`/orders?status=${statuses.join(',')}`);

/** Cancel before completion; the server releases reserved stock. A reason is required. */
export const cancelOrder = (order: Pick<OrderDto, 'id' | 'version'>, reason: string) =>
  api.post<OrderDto>(`/orders/${order.id}/cancel`, { reason, expected_version: order.version }, newIdempotencyKey());

/** Full refund, or a partial money amount (allocated newest payment first). The caller keeps the key
 *  so a retry of the same submission is replayed, never duplicated. */
export const refundOrder = (orderId: string, reason: string, idempotencyKey: string, amount?: string) =>
  api.post<OrderDto>(`/orders/${orderId}/refunds`, amount ? { kind: 'partial', reason, amount } : { kind: 'full', reason }, idempotencyKey);
