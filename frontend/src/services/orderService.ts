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
}

/** Server-authoritative totals preview; nothing is created or reserved. */
export const quote = (input: OrderInput) => api.post<QuoteDto>('/orders/quote', input);

/** The caller keeps the key so a retry of the same submission is replayed, never duplicated. */
export const createOrder = (input: OrderInput, idempotencyKey: string) => api.post<OrderDto>('/orders', input, idempotencyKey);

export const listActiveOrders = () => api.get<OrderDto[]>('/orders?status=pending,preparing,ready');
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

/** Full refund of a completed order (partial refunds are an open decision, Q-REF-5). The caller keeps
 *  the key so a retry of the same submission is replayed, never duplicated. */
export const refundOrder = (orderId: string, reason: string, idempotencyKey: string) =>
  api.post<OrderDto>(`/orders/${orderId}/refunds`, { kind: 'full', reason }, idempotencyKey);
