import { useEffect, useRef } from 'react';
import { AlertTriangle, Bell, CheckCircle2, Info, X } from 'lucide-react';
import { can, useAuth } from '../../stores/authStore';
import { useFeatureSettings } from '../../stores/featureSettingsStore';
import { usePreferenceSettings } from '../../stores/preferenceSettingsStore';
import { useStaffingSettings } from '../../stores/staffingSettingsStore';
import { dismiss, isOwnOrder, notify, useNotifications } from '../../stores/notificationStore';
import { listActiveOrders } from '../../services/orderService';
import { getPosMenu } from '../../services/productService';
import { alertGates, newOrdersSince, stockChanges, waitingOrders, type StockSignal } from '../../utils/liveAlerts';
import { installAudioUnlock, playSound } from '../../utils/sound';

// Polling cadence. Not real-time: a light background request every N seconds, paused while the tab
// is hidden, backing off after errors, and marked as background so it never extends the session.
export const ORDER_POLL_MS = 20_000;
export const STOCK_POLL_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;

function usePoll(enabled: boolean, intervalMs: number, tick: () => Promise<void>) {
  const tickRef = useRef(tick);
  tickRef.current = tick;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer = 0;
    let delay = intervalMs;
    const run = async () => {
      if (stopped) return;
      if (typeof document !== 'undefined' && document.hidden) {
        timer = window.setTimeout(run, intervalMs);
        return;
      }
      try {
        await tickRef.current();
        delay = intervalMs;
      } catch {
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      }
      if (!stopped) timer = window.setTimeout(run, delay);
    };
    void run();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [enabled, intervalMs]);
}

/** Order and low-stock alerts for the whole signed-in app, plus the notification stack. */
export default function LiveAlerts() {
  const { user } = useAuth();
  const { flags } = useFeatureSettings();
  const { settings: prefs } = usePreferenceSettings();
  const { settings: staffing } = useStaffingSettings();
  const gates = alertGates(flags, prefs);

  useEffect(() => installAudioUnlock(), []);

  const seenOrders = useRef<Set<string> | null>(null);
  const announcedWaiting = useRef<Set<string>>(new Set());
  const ordersOn = (gates.newOrders || gates.waitingOrders) && can(user, 'orders.view');
  useEffect(() => {
    if (!ordersOn) seenOrders.current = null; // re-baseline when turned back on
  }, [ordersOn]);
  usePoll(ordersOn, ORDER_POLL_MS, async () => {
    const orders = await listActiveOrders(true);
    if (gates.newOrders) {
      const fresh = newOrdersSince(seenOrders.current, orders, isOwnOrder);
      if (fresh.length) {
        notify({ tone: 'info', title: fresh.length === 1 ? `New order #${fresh[0].number}` : `${fresh.length} new orders`,
                 message: fresh.length === 1 ? undefined : fresh.map((o) => `#${o.number}`).join(', ') });
        if (gates.alertSound) playSound('alert');
      }
    }
    seenOrders.current = new Set(orders.map((o) => o.id));
    if (gates.waitingOrders) {
      const late = waitingOrders(orders, new Date(), staffing.orderWaitingMinutes, announcedWaiting.current);
      late.forEach((o) => announcedWaiting.current.add(o.id));
      if (late.length) {
        notify({ tone: 'warning', title: `Waiting over ${staffing.orderWaitingMinutes} min`,
                 message: late.map((o) => `#${o.number}`).join(', ') });
        if (gates.alertSound) playSound('alert');
      }
    }
  });

  const lastStock = useRef<StockSignal | null>(null);
  const stockOn = gates.lowStock && flags.inventory !== false && can(user, 'pos.view');
  useEffect(() => {
    if (!stockOn) lastStock.current = null;
  }, [stockOn]);
  usePoll(stockOn, STOCK_POLL_MS, async () => {
    const menu = await getPosMenu(true);
    const names = new Map(menu.products.map((p) => [p.id, p.name]));
    const availability = menu.availability ?? {};
    const signal: StockSignal = { low: {}, unavailable: {} };
    for (const [id, a] of Object.entries(availability)) {
      signal.low[id] = a.low_stock;
      signal.unavailable[id] = !a.sellable;
    }
    for (const level of menu.stock) {
      if (level.subject_type !== 'product') continue;
      if (level.status === 'low') signal.low[level.subject_id] = [names.get(level.subject_id) ?? 'stock'];
      if (level.status === 'out') signal.unavailable[level.subject_id] = true;
    }
    const changes = stockChanges(lastStock.current, signal);
    lastStock.current = signal;
    if (changes.unavailable.length) {
      notify({ tone: 'danger', title: 'Now unavailable', message: changes.unavailable.map((id) => names.get(id) ?? 'Product').join(', ') });
      if (gates.alertSound) playSound('alert');
    }
    if (changes.low.length) {
      notify({ tone: 'warning', title: 'Low stock', message: changes.low.map((id) => `${names.get(id) ?? 'Product'} (${signal.low[id].join(', ')})`).join('; ') });
    }
  });

  const items = useNotifications();
  if (!items.length) return null;
  const icon = { info: Bell, success: CheckCircle2, warning: AlertTriangle, danger: AlertTriangle } as const;
  return (
    <div className="live-alerts" role="region" aria-label="Notifications" aria-live="polite">
      {items.map((n) => {
        const Icon = icon[n.tone] ?? Info;
        return (
          <div key={n.id} className={`live-alert live-alert--${n.tone}`} role="status">
            <Icon size={16} />
            <div className="live-alert__body">
              <strong>{n.title}</strong>
              {n.message && <span>{n.message}</span>}
            </div>
            <button type="button" className="icon-btn" aria-label="Dismiss notification" onClick={() => dismiss(n.id)}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
