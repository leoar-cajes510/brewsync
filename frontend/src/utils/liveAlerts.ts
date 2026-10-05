// Pure rules for live alerts (unit-tested). The component that polls the server lives in
// components/layout/LiveAlerts.tsx; nothing here talks to the network.

import type { FeatureFlags } from '../stores/featureSettingsStore';
import type { PreferenceSettings } from '../stores/preferenceSettingsStore';

export interface AlertGates {
  live: boolean;
  newOrders: boolean;
  waitingOrders: boolean;
  lowStock: boolean;
  payments: boolean;
  alertSound: boolean;
  paymentSound: boolean;
  tapSound: boolean;
}

/** Every alert needs its business feature (Settings → Features), the matching preference AND the
 *  Notifications master switch (Settings → Preferences). Sounds need Sound Effects + the preference. */
export function alertGates(flags: FeatureFlags, prefs: PreferenceSettings): AlertGates {
  const notes = prefs.notifications;
  return {
    live: flags.liveUpdates && prefs.liveUpdates,
    newOrders: notes && flags.orderAlerts && prefs.newOrderAlerts,
    waitingOrders: notes && flags.orderAlerts && prefs.orderWaitingAlerts,
    lowStock: notes && flags.lowStockAlerts && prefs.lowStockAlerts,
    payments: notes && prefs.paymentAlerts,
    alertSound: flags.soundEffects && prefs.interfaceSounds,
    paymentSound: flags.soundEffects && prefs.paymentSound,
    tapSound: flags.soundEffects && prefs.interfaceSounds,
  };
}

export interface OrderLike {
  id: string;
  number: string | null;
  status: string;
  created_at: string;
  started_at?: string | null;
}

/** New orders since the previous poll. The first poll (``previous`` null) only sets the baseline. */
export function newOrdersSince(previous: ReadonlySet<string> | null, orders: OrderLike[], isOwn: (id: string) => boolean): OrderLike[] {
  if (previous === null) return [];
  return orders.filter((o) => !previous.has(o.id) && !isOwn(o.id));
}

/** Orders still pending/preparing past the waiting threshold that were not announced yet. */
export function waitingOrders(orders: OrderLike[], now: Date, thresholdMinutes: number, announced: ReadonlySet<string>): OrderLike[] {
  if (!(thresholdMinutes > 0)) return [];
  const limit = thresholdMinutes * 60_000;
  return orders.filter(
    (o) => (o.status === 'pending' || o.status === 'preparing') && !announced.has(o.id) && now.getTime() - new Date(o.created_at).getTime() >= limit,
  );
}

export interface StockSignal {
  /** product id → names of ingredients at/below threshold (still sellable). */
  low: Record<string, string[]>;
  /** product id → true when the product cannot be made now. */
  unavailable: Record<string, boolean>;
}

/** Products that BECAME low or unavailable since the last poll (never repeats; first poll = baseline). */
export function stockChanges(previous: StockSignal | null, current: StockSignal): { low: string[]; unavailable: string[] } {
  if (previous === null) return { low: [], unavailable: [] };
  const low = Object.keys(current.low).filter((id) => current.low[id].length > 0 && !(previous.low[id]?.length) && !current.unavailable[id]);
  const unavailable = Object.keys(current.unavailable).filter((id) => current.unavailable[id] && !previous.unavailable[id]);
  return { low, unavailable };
}
