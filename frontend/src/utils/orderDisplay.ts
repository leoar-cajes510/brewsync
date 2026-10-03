import type { Order, OrderType } from '../types/order';

// Display helpers for the Orders UI. Totals come from the server (order.totals);
// the local sum is only a fallback for orders without server totals.

export interface OrderTotals {
  itemCount: number;
  quantity: number;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
}

export function orderTotals(order: Order): OrderTotals {
  const itemCount = order.items.length;
  const quantity = order.items.reduce((sum, i) => sum + i.quantity, 0);
  if (order.totals) {
    const t = order.totals;
    return { itemCount, quantity, subtotal: t.subtotal, discount: t.discount, vat: t.tax, total: t.total };
  }
  const subtotal = order.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const total = subtotal - order.discount;
  return {
    itemCount: order.items.length,
    quantity: order.items.reduce((sum, i) => sum + i.quantity, 0),
    subtotal,
    discount: order.discount,
    vat: 0,
    total,
  };
}

export function minutesSince(date: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const typeLabels: Record<OrderType, string> = {
  'dine-in': 'Dine-In',
  takeout: 'Takeout',
  delivery: 'Delivery',
};

export function orderTypeLabel(order: Pick<Order, 'type' | 'tag'>): string {
  return order.tag ? `${typeLabels[order.type]} · ${order.tag}` : typeLabels[order.type];
}
