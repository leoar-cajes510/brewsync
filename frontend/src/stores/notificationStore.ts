import { useSyncExternalStore } from 'react';

// On-screen notifications (Settings → Preferences → Notifications). Interface only: nothing here
// changes business data. Each notification auto-dismisses; the stack is capped.

export type NotificationTone = 'info' | 'success' | 'warning' | 'danger';

export interface AppNotification {
  id: number;
  title: string;
  message?: string;
  tone: NotificationTone;
}

const MAX_VISIBLE = 4;
let items: AppNotification[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function notify(n: Omit<AppNotification, 'id'>, ttlMs = 7000): void {
  const id = nextId++;
  items = [...items, { ...n, id }].slice(-MAX_VISIBLE);
  emit();
  if (typeof window !== 'undefined') window.setTimeout(() => dismiss(id), ttlMs);
}

export function dismiss(id: number): void {
  const before = items.length;
  items = items.filter((n) => n.id !== id);
  if (items.length !== before) emit();
}

export const getNotifications = (): AppNotification[] => items;

export function useNotifications(): AppNotification[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
    () => items,
  );
}

/** Orders created in THIS browser tab: never announced back to the cashier who placed them. */
const ownOrders = new Set<string>();
export const markOwnOrder = (id: string) => ownOrders.add(id);
export const isOwnOrder = (id: string) => ownOrders.has(id);

/** Test helper. */
export function _resetNotifications(): void {
  items = [];
  ownOrders.clear();
  emit();
}
