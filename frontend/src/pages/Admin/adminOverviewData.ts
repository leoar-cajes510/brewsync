import type { OrderType } from '../../types/order';
import type { CategoryDto, ExpenseDto, OrderDto, ProductDto, StockLevelDto } from '../../types/api';
import { errorMessage } from '../../services/api';
import { listCategories, listProducts } from '../../services/productService';
import { listStock } from '../../services/inventoryService';
import { listOrders } from '../../services/orderService';
import { listExpenses } from '../../services/expenseService';
import { fromApiOrderType } from '../../utils/apiMappers';
import { formatPeso } from '../../utils/currency';
import { getSalesFeed } from '../../services/analyticsService';
import { endOfDay, presetRange, startOfDay, type AnalyticsSource } from '../../components/admin/analytics/analyticsData';

// Admin → Overview data, built only from persisted records returned by the API. Sales figures
// (today's sales, average order, sales trend, best sellers) come from GET /analytics/sales
// (completed sales net of refunds, BUSINESS-RULES §16).

export interface Kpi {
  id: 'sales' | 'orders' | 'average' | 'expenses';
  label: string;
  value: string;
  trend?: { direction: 'up' | 'down'; text: string };
  detail: string;
}

export type SalesPeriod = 'today' | 'week' | 'month';

export interface SalesPoint {
  label: string;
  value: number;
}

export interface SalesSeries {
  total: number;
  peakNote: string;
  points: SalesPoint[];
}

export interface AttentionItem {
  id: string;
  tone: 'warning' | 'danger' | 'info';
  kicker: string;
  meta: string;
  title: string;
  detail: string;
  action: { label: string; to?: string };
}

export interface BestSeller {
  name: string;
  sold: number;
  revenue: number;
}

export interface LowStockItem {
  name: string;
  location: string;
  left: number;
  unit: string;
}

export interface RecentOrder {
  number: string;
  customer: string;
  type: OrderType;
  amount: number;
  status: 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled' | 'refunded';
  time: string;
}

export interface OverviewData {
  kpis: Kpi[];
  attention: AttentionItem[];
  lowStock: LowStockItem[];
  recentOrders: RecentOrder[];
  categories: string[];
  /** Completed sales of the last 35 days (null if analytics could not be loaded). */
  feed: AnalyticsSource | null;
  bestSellers: BestSeller[];
  /** Sections that could not be loaded (the rest of the Overview still renders). */
  errors: string[];
}

const NO_ANALYTICS = 'Could not load sales analytics';
const DAY_MS = 86_400_000;

const inRange = (d: Date, start: Date, end: Date) => d >= start && d <= end;

/** Sales trend for the Overview chart: hourly today, daily this week, weekly this month. */
export function salesSeries(feed: AnalyticsSource, period: SalesPeriod): SalesSeries {
  const range = presetRange(period);
  const sales = feed.sales.filter((s) => inRange(s.at, range.start, range.end));
  let points: SalesPoint[];
  if (period === 'today') {
    const lastHour = new Date().getHours();
    points = Array.from({ length: lastHour + 1 }, (_, h) => ({
      label: `${String(h).padStart(2, '0')}:00`,
      value: sales.filter((s) => s.at.getHours() === h).reduce((sum, s) => sum + s.total, 0),
    }));
  } else if (period === 'week') {
    const days = Math.round((startOfDay(range.end).getTime() - range.start.getTime()) / DAY_MS) + 1;
    points = Array.from({ length: days }, (_, i) => {
      const day = new Date(range.start.getTime() + i * DAY_MS);
      return {
        label: day.toLocaleDateString(undefined, { weekday: 'short' }),
        value: sales.filter((s) => inRange(s.at, startOfDay(day), endOfDay(day))).reduce((sum, s) => sum + s.total, 0),
      };
    });
  } else {
    const weeks = Math.ceil((range.end.getDate()) / 7);
    points = Array.from({ length: weeks }, (_, i) => ({
      label: `Week ${i + 1}`,
      value: sales.filter((s) => Math.floor((s.at.getDate() - 1) / 7) === i).reduce((sum, s) => sum + s.total, 0),
    }));
  }
  const total = sales.reduce((sum, s) => sum + s.total, 0);
  const peak = points.reduce((best, p) => (p.value > best.value ? p : best), points[0] ?? { label: '—', value: 0 });
  return { total, peakNote: total > 0 ? `Peak ${peak.label} · ${formatPeso(peak.value)}` : 'No sales yet in this period', points: total > 0 ? points : [] };
}

/** Local calendar date (YYYY-MM-DD) of the terminal. */
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

function settled<T>(result: PromiseSettledResult<T>, label: string, errors: string[]): T | null {
  if (result.status === 'fulfilled') return result.value;
  errors.push(`${label}: ${errorMessage(result.reason)}`);
  return null;
}

export async function loadOverview(): Promise<OverviewData> {
  const results = await Promise.allSettled([
    listOrders(['pending', 'preparing', 'ready', 'completed', 'cancelled']),
    listStock(),
    listProducts(),
    listCategories(),
    listExpenses(),
    getSalesFeed({ start: startOfDay(new Date(Date.now() - 35 * DAY_MS)), end: endOfDay(new Date()) }),
  ]);
  const errors: string[] = [];
  const orders = settled<OrderDto[]>(results[0], 'Orders', errors);
  const levels = settled<StockLevelDto[]>(results[1], 'Inventory', errors);
  const products = settled<ProductDto[]>(results[2], 'Products', errors);
  const categories = settled<CategoryDto[]>(results[3], 'Categories', errors);
  const expenses = settled<ExpenseDto[]>(results[4], 'Expenses', errors);
  const feed = settled<AnalyticsSource>(results[5], 'Sales analytics', errors);
  const todayRange = presetRange('today');
  const yesterday = { start: new Date(todayRange.start.getTime() - DAY_MS), end: new Date(todayRange.end.getTime() - DAY_MS) };
  const sumIn = (r: { start: Date; end: Date }) => (feed?.sales ?? []).filter((x) => inRange(x.at, r.start, r.end));
  const todaySales = sumIn(todayRange);
  const todayTotal = todaySales.reduce((sum, x) => sum + x.total, 0);
  const yesterdayTotal = sumIn(yesterday).reduce((sum, x) => sum + x.total, 0);
  const salesTrend =
    feed && yesterdayTotal > 0
      ? { direction: (todayTotal >= yesterdayTotal ? 'up' : 'down') as 'up' | 'down', text: `${Math.round(Math.abs((todayTotal - yesterdayTotal) / yesterdayTotal) * 100)}% vs yesterday` }
      : undefined;
  const month = presetRange('month');
  const sold = new Map<string, BestSeller>();
  for (const sale of sumIn(month))
    for (const line of sale.lines) {
      const cur = sold.get(line.product) ?? { name: line.product, sold: 0, revenue: 0 };
      cur.sold += line.qty;
      cur.revenue += line.qty * line.price;
      sold.set(line.product, cur);
    }
  const bestSellers = [...sold.values()].sort((a, b) => b.sold - a.sold || b.revenue - a.revenue).slice(0, 5);

  const today = localDate(new Date());
  const open = (orders ?? []).filter((o) => o.status === 'pending' || o.status === 'preparing' || o.status === 'ready');
  const byType = (type: OrderDto['order_type']) => open.filter((o) => o.order_type === type).length;
  const todaysExpenses = (expenses ?? []).filter((e) => e.expense_date === today);
  const expenseCents = todaysExpenses.reduce((sum, e) => sum + Math.round(Number(e.amount) * 100), 0);

  const kpis: Kpi[] = [
    feed
      ? { id: 'sales', label: "Today's Sales", value: formatPeso(todayTotal), trend: salesTrend, detail: `${todaySales.length} completed ${todaySales.length === 1 ? 'order' : 'orders'} today` }
      : { id: 'sales', label: "Today's Sales", value: '—', detail: NO_ANALYTICS },
    {
      id: 'orders',
      label: 'Open Orders',
      value: orders ? String(open.length) : '—',
      detail: orders ? `${byType('dine_in')} Dine-In · ${byType('takeout')} Takeout · ${byType('delivery')} Delivery` : 'Could not load orders',
    },
    feed
      ? { id: 'average', label: 'Average Order', value: todaySales.length ? formatPeso(todayTotal / todaySales.length) : formatPeso(0), detail: todaySales.length ? 'Today · net of refunds' : 'No completed orders today' }
      : { id: 'average', label: 'Average Order', value: '—', detail: NO_ANALYTICS },
    {
      id: 'expenses',
      label: 'Expenses',
      value: expenses ? formatPeso(expenseCents / 100) : '—',
      detail: expenses ? `Today · ${todaysExpenses.length} ${todaysExpenses.length === 1 ? 'entry' : 'entries'}` : 'Could not load expenses',
    },
  ];

  const names = new Map((products ?? []).map((p) => [p.id, p.name]));
  const lowStock: LowStockItem[] = (levels ?? [])
    .filter((l) => l.subject_type === 'product' && (l.status === 'low' || l.status === 'out'))
    .map((l) => ({
      name: names.get(l.subject_id) ?? 'Unknown product',
      location: l.status === 'out' ? 'Out of stock' : `Low stock · threshold ${Number(l.low_stock_threshold)}`,
      left: Number(l.available),
      unit: 'left',
    }))
    .sort((a, b) => a.left - b.left);

  const attention: AttentionItem[] = lowStock.length
    ? [
        {
          id: 'stock',
          tone: 'warning',
          kicker: 'Low Stock',
          meta: 'Inventory',
          title: `${lowStock.length} ${lowStock.length === 1 ? 'product needs' : 'products need'} restocking`,
          detail: lowStock.slice(0, 3).map((i) => i.name).join(', '),
          action: { label: 'Open Inventory', to: '/admin/inventory' },
        },
      ]
    : [];

  const recentOrders: RecentOrder[] = [...(orders ?? [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6)
    .map((o) => ({
      number: o.number,
      customer: o.tag ?? '—',
      type: fromApiOrderType(o.order_type),
      amount: Number(o.totals.total),
      status: o.refund_status === 'refunded' ? 'refunded' : o.status,
      time: ago(o.created_at),
    }));

  return {
    kpis,
    attention,
    lowStock,
    recentOrders,
    categories: (categories ?? []).map((c) => c.name),
    feed,
    bestSellers,
    errors,
  };
}
