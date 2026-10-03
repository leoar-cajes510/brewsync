import { api } from './api';
import type { OrderDto } from '../types/api';

// Admin-only archive (✱archive.manage). Restore rules (window, completed only) are enforced by the server.
/** `archived`: archived orders; `cancelled_review`: cancelled orders not yet archived. */
export const listArchive = () => api.get<{ archived: OrderDto[]; cancelled_review: OrderDto[] }>('/archive');
export const archiveOrders = (orderIds: string[], reason: string) => api.post<unknown[]>('/archive', { order_ids: orderIds, reason });
export const restoreOrder = (orderId: string) => api.post<unknown>(`/archive/${orderId}/restore`);
