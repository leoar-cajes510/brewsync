import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import LiveClock from '../../components/layout/LiveClock';
import SearchBar from '../../components/ui/SearchBar';
import Tabs from '../../components/ui/Tabs';
import Button from '../../components/ui/Button';
import LoadingState from '../../components/ui/LoadingState';
import OrderBoard from '../../components/orders/OrderBoard';
import OrderDetailsPanel from '../../components/orders/OrderDetailsPanel';
import CancelOrderDialog from '../../components/orders/CancelOrderDialog';
import CheckoutModal from '../../components/pos/CheckoutModal';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import type { Order, OrderType } from '../../types/order';
import type { OrderDto } from '../../types/api';
import { ApiError, errorMessage } from '../../services/api';
import { cancelOrder, changeStatus, listActiveOrders } from '../../services/orderService';
import { confirmPayment, voidPayment } from '../../services/paymentService';
import { orderView } from '../../utils/apiMappers';
import { useTerms } from '../../stores/terminologySettingsStore';
import { useFeatureSettings } from '../../stores/featureSettingsStore';
import { alertGates } from '../../utils/liveAlerts';
import { usePreferenceSettings } from '../../stores/preferenceSettingsStore';
import '../../components/orders/orders.css';

type Filter = 'all' | OrderType;

const AUTO_REFRESH_MS = 15_000;

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

// Active orders (pending / preparing / ready) from GET /orders. There is no realtime
// transport yet (Q-ARCH-3): the board refreshes after every action and on demand.
export default function OrdersPage() {
  const now = useNow();
  const { terms } = useTerms();
  const [dtos, setDtos] = useState<OrderDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collecting, setCollecting] = useState<OrderDto | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const refresh = useCallback(async (background = false) => {
    if (!background) setLoadError(null);
    try {
      setDtos(await listActiveOrders(background));
      setLoadError(null);
    } catch (err) {
      if (!background) setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Settings → Preferences "Auto refresh" (PREF-01): poll the board while idle. Polling is the
  // documented fallback until a real-time transport is chosen (Q-ARCH-3).
  const { settings: prefs } = usePreferenceSettings();
  const idle = !busyId && !collecting && !cancelling;
  // Live Updates also keep the board current. Background requests never extend the session.
  const { flags } = useFeatureSettings();
  const live = alertGates(flags, prefs).live;
  useEffect(() => {
    if (!(prefs.autoRefresh || live) || !idle) return;
    const id = window.setInterval(() => {
      if (!document.hidden) void refresh(true);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [prefs.autoRefresh, live, idle, refresh]);

  const orders = useMemo(() => (dtos ?? []).map(orderView), [dtos]);

  const filterItems = useMemo(
    () => [
      { value: 'all', label: 'All Active', count: orders.length },
      { value: 'dine-in', label: 'Dine-In', count: orders.filter((o) => o.type === 'dine-in').length },
      { value: 'takeout', label: 'Takeout', count: orders.filter((o) => o.type === 'takeout').length },
      { value: 'delivery', label: 'Delivery', count: orders.filter((o) => o.type === 'delivery').length },
    ],
    [orders],
  );

  const visibleOrders = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    return orders.filter((o) => (filter === 'all' || o.type === filter) && (!q || o.number.includes(q) || o.customer.toLowerCase().includes(q)));
  }, [orders, filter, query]);

  const selected = orders.find((o) => o.id === selectedId) ?? null;
  const dtoOf = (order: Order) => dtos?.find((d) => d.id === order.id) ?? null;

  const replace = (fresh: OrderDto) =>
    setDtos((prev) => {
      // Action responses carry cashier_id only; keep the name the board already resolved.
      const previous = (prev ?? []).find((d) => d.id === fresh.id);
      const updated = { ...fresh, cashier_name: fresh.cashier_name ?? previous?.cashier_name };
      const rest = (prev ?? []).filter((d) => d.id !== updated.id);
      return ['pending', 'preparing', 'ready'].includes(updated.status) ? [...rest, updated].sort((a, b) => a.created_at.localeCompare(b.created_at)) : rest;
    });

  const select = (order: Order) => setSelectedId(order.id);

  const advance = async (order: Order) => {
    select(order);
    const dto = dtoOf(order);
    if (!dto || busyId) return;
    if (dto.status === 'ready' && dto.payment_status !== 'paid') {
      setCollecting(dto);
      return;
    }
    const target = dto.status === 'pending' ? 'preparing' : dto.status === 'preparing' ? 'ready' : 'completed';
    setBusyId(dto.id);
    setActionError(null);
    try {
      const updated = await changeStatus(dto, target);
      replace(updated);
      if (target === 'completed') {
        setSelectedId(null);
        setFeedback(`Order #${updated.number} completed`);
      }
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'VERSION_CONFLICT' || err.code === 'INVALID_TRANSITION')) {
        setActionError(`${errorMessage(err)} The board was refreshed.`);
        void refresh();
      } else setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (order: Order, reason: string) => {
    const dto = dtoOf(order);
    if (!dto) return;
    try {
      const updated = await cancelOrder(dto, reason);
      replace(updated);
      setCancelling(null);
      setSelectedId(null);
      setFeedback(`Order #${updated.number} cancelled`);
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'VERSION_CONFLICT' || err.code === 'INVALID_TRANSITION')) void refresh();
      throw err;
    }
  };

  // Pending payments: "Confirm" completes the payment (issuing the receipt when the order
  // becomes paid); "Void" discards it. The server decides; the board shows its result.
  const settlePending = async (order: Order, paymentId: string, action: 'confirm' | 'void') => {
    if (busyId) return;
    setBusyId(order.id);
    setActionError(null);
    try {
      const updated = await (action === 'confirm' ? confirmPayment : voidPayment)(order.id, paymentId);
      replace(updated);
      setFeedback(action === 'confirm' ? `Payment confirmed for order #${updated.number}` : `Payment voided for order #${updated.number}`);
    } catch (err) {
      setActionError(errorMessage(err));
      void refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="orders">
      <section className="orders__workspace">
        <header className="orders__toolbar">
          <h1 className="orders__title">{terms('order')}</h1>
          <SearchBar
            className="orders__search"
            placeholder="Search orders by #…"
            shortcut="⌘K"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="orders__filters">
            <Tabs items={filterItems} value={filter} onChange={(v) => setFilter(v as Filter)} />
          </div>
          <div className="orders__status">
            <button type="button" className="orders__sync" onClick={() => void refresh()} title="Refresh orders">
              <span className="status-dot" />
              <span className="orders__sync-label">Refresh</span>
              <RefreshCw size={13} />
            </button>
            <LiveClock now={now} className="orders__clock" />
          </div>
        </header>

        {actionError && (
          <div className="api-status api-status--error" role="alert">
            {actionError}
            <Button size="sm" onClick={() => setActionError(null)}>
              Dismiss
            </Button>
          </div>
        )}
        {feedback && <ActionFeedback message={feedback} onDone={clearFeedback} />}

        {dtos === null ? (
          loadError ? (
            <div className="api-status api-status--error" role="alert">
              {loadError}
              <Button size="sm" onClick={() => void refresh()}>
                Try again
              </Button>
            </div>
          ) : (
            <LoadingState label="Loading orders…" />
          )
        ) : (
          <OrderBoard orders={visibleOrders} now={now} selectedId={selectedId} onSelect={select} onAdvance={(o) => void advance(o)} />
        )}
      </section>

      <OrderDetailsPanel
        order={selected}
        now={now}
        onAdvance={(o) => void advance(o)}
        onPay={() => undefined}
        onCancel={setCancelling}
        onConfirmPayment={(o, id) => void settlePending(o, id, 'confirm')}
        onVoidPayment={(o, id) => void settlePending(o, id, 'void')}
        collecting={false}
        onCollectingChange={(on) => {
          const dto = selected && dtoOf(selected);
          if (on && dto) setCollecting(dto);
        }}
      />

      <CancelOrderDialog order={cancelling} onClose={() => setCancelling(null)} onCancel={cancel} />

      <CheckoutModal
        order={collecting}
        onClose={() => setCollecting(null)}
        onPaid={(paid) => {
          replace(paid);
          setCollecting(paid);
        }}
      />
    </div>
  );
}
