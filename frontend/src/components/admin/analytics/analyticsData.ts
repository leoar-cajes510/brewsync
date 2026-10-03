// Analytics data model + aggregation. Every section is computed from an
// AnalyticsSource. The real source is empty until the backend stores sales and
// expenses via the analytics API (not implemented yet), so every section renders
// its empty state. Nothing is simulated in the browser.

export type Channel = 'Dine In' | 'Takeout' | 'Delivery';
export const CHANNELS: Channel[] = ['Dine In', 'Takeout', 'Delivery'];

export interface SaleLine {
  product: string;
  code: string;
  category: string;
  qty: number;
  price: number;
  /** Estimated unit cost (for margin). */
  cost: number;
}

export interface SaleRecord {
  id: string;
  at: Date;
  total: number;
  channel: Channel;
  payment: string;
  lines: SaleLine[];
}

export interface ExpenseRecord {
  date: Date;
  category: string;
  amount: number;
}

export interface AnalyticsSource {
  sales: SaleRecord[];
  expenses: ExpenseRecord[];
  isDemo: boolean;
}

/** Real business data. Empty on a fresh system — no sales/expense store exists yet. */
export const REAL_SOURCE: AnalyticsSource = { sales: [], expenses: [], isDemo: false };

/* ------------------------------ Date ranges ------------------------------ */

export type RangePreset = 'today' | 'week' | 'month' | 'last30' | 'custom';

export interface DateRange {
  start: Date;
  /** Inclusive end (end of day). */
  end: Date;
}

const DAY = 86_400_000;
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
export const dayCount = (r: DateRange) => Math.round((startOfDay(r.end).getTime() - startOfDay(r.start).getTime()) / DAY) + 1;

export function presetRange(preset: Exclude<RangePreset, 'custom'>, now = new Date()): DateRange {
  const end = endOfDay(now);
  if (preset === 'today') return { start: startOfDay(now), end };
  if (preset === 'week') {
    const s = startOfDay(now);
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
    return { start: s, end };
  }
  if (preset === 'month') return { start: new Date(now.getFullYear(), now.getMonth(), 1), end };
  const s = startOfDay(now);
  s.setDate(s.getDate() - 29);
  return { start: s, end };
}

/** The equal-length period immediately before `r`. */
export function previousRange(r: DateRange): DateRange {
  const n = dayCount(r);
  const start = startOfDay(r.start);
  start.setDate(start.getDate() - n);
  const end = endOfDay(r.start);
  end.setDate(end.getDate() - 1);
  return { start, end };
}

const inRange = (d: Date, r: DateRange) => d >= r.start && d <= r.end;
export const shortDate = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/* ------------------------------ Aggregations ----------------------------- */

export interface Kpis {
  sales: number;
  orders: number;
  aov: number;
  expenses: number;
  net: number;
}

export function computeKpis(src: AnalyticsSource, r: DateRange): Kpis {
  const sales = src.sales.filter((s) => inRange(s.at, r));
  const revenue = sales.reduce((t, s) => t + s.total, 0);
  const expenses = src.expenses.filter((e) => inRange(e.date, r)).reduce((t, e) => t + e.amount, 0);
  return { sales: revenue, orders: sales.length, aov: sales.length ? revenue / sales.length : 0, expenses, net: revenue - expenses };
}

export interface TrendPoint {
  label: string;
  value: number;
  orders: number;
  /** Bucket start (day/week views). */
  date: Date | null;
  /** Same bucket index in the previous period, when comparing. */
  previous: number | null;
}

/** Hourly buckets for a single day, daily buckets up to ~2 months, weekly beyond. */
export function computeTrend(src: AnalyticsSource, r: DateRange, compare: boolean): { unit: 'hour' | 'day' | 'week'; points: TrendPoint[] } {
  const days = dayCount(r);
  const prev = previousRange(r);
  const bucketsFor = (range: DateRange, unit: 'hour' | 'day' | 'week') => {
    const n = unit === 'hour' ? 24 : unit === 'day' ? dayCount(range) : Math.ceil(dayCount(range) / 7);
    const vals = Array.from({ length: n }, () => ({ value: 0, orders: 0 }));
    for (const s of src.sales) {
      if (!inRange(s.at, range)) continue;
      const i = unit === 'hour' ? s.at.getHours() : Math.floor((startOfDay(s.at).getTime() - startOfDay(range.start).getTime()) / DAY / (unit === 'week' ? 7 : 1));
      vals[i].value += s.total;
      vals[i].orders += 1;
    }
    return vals;
  };
  const unit = days === 1 ? 'hour' : days <= 62 ? 'day' : 'week';
  const cur = bucketsFor(r, unit);
  const before = compare ? bucketsFor(prev, unit) : null;
  const points = cur.map((b, i) => {
    let label: string;
    let date: Date | null = null;
    if (unit === 'hour') label = `${((i + 11) % 12) + 1}${i < 12 ? 'a' : 'p'}`;
    else {
      date = new Date(r.start);
      date.setDate(date.getDate() + i * (unit === 'week' ? 7 : 1));
      label = shortDate(date);
    }
    return { label, date, value: b.value, orders: b.orders, previous: before ? (before[i]?.value ?? 0) : null };
  });
  // Trading day view: trim to business hours 6 AM – 10 PM.
  return { unit, points: unit === 'hour' ? points.slice(6, 23) : points };
}

export interface HourlyStats {
  /** Orders per hour, index 0 = OPEN_HOUR. */
  counts: number[];
  total: number;
  morning: { from: number; to: number; share: number } | null;
  afternoon: { from: number; to: number; share: number } | null;
  busiestDay: { name: string; share: number } | null;
}

export const OPEN_HOUR = 7;
export const CLOSE_HOUR = 21;

export function computeHourly(src: AnalyticsSource, r: DateRange): HourlyStats {
  const counts = Array.from({ length: CLOSE_HOUR - OPEN_HOUR + 1 }, () => 0);
  const byDay = Array.from({ length: 7 }, () => 0);
  let total = 0;
  for (const s of src.sales) {
    if (!inRange(s.at, r)) continue;
    const h = s.at.getHours();
    if (h >= OPEN_HOUR && h <= CLOSE_HOUR) counts[h - OPEN_HOUR] += 1;
    byDay[s.at.getDay()] += 1;
    total += 1;
  }
  // Best 2-hour window within [lo, hi) hours.
  const window = (lo: number, hi: number) => {
    let best: { from: number; to: number; share: number } | null = null;
    for (let h = lo; h + 2 <= hi; h++) {
      const v = counts[h - OPEN_HOUR] + counts[h + 1 - OPEN_HOUR];
      if (v > 0 && (!best || v > best.share)) best = { from: h, to: h + 2, share: v };
    }
    return best && total ? { ...best, share: Math.round((best.share / total) * 100) } : null;
  };
  const dayIdx = byDay.indexOf(Math.max(...byDay));
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return {
    counts,
    total,
    morning: window(OPEN_HOUR, 12),
    afternoon: window(12, CLOSE_HOUR + 1),
    busiestDay: total && dayCount(r) >= 7 ? { name: names[dayIdx], share: Math.round((byDay[dayIdx] / total) * 100) } : null,
  };
}

export interface Split {
  name: string;
  count: number;
  amount: number;
  share: number;
}

export function computeSplits(src: AnalyticsSource, r: DateRange) {
  const sales = src.sales.filter((s) => inRange(s.at, r));
  const group = (key: (s: SaleRecord) => string, order?: string[]): Split[] => {
    const m = new Map<string, { count: number; amount: number }>();
    order?.forEach((k) => m.set(k, { count: 0, amount: 0 }));
    for (const s of sales) {
      const g = m.get(key(s)) ?? { count: 0, amount: 0 };
      g.count += 1;
      g.amount += s.total;
      m.set(key(s), g);
    }
    const list = [...m.entries()].map(([name, g]) => ({ name, ...g, share: sales.length ? Math.round((g.count / sales.length) * 100) : 0 }));
    return order ? list : list.sort((a, b) => b.amount - a.amount);
  };
  return { channels: group((s) => s.channel, CHANNELS), payments: group((s) => s.payment) };
}

export interface ProductStat {
  code: string;
  name: string;
  category: string;
  units: number;
  revenue: number;
  avgPrice: number;
  margin: number;
  share: number;
}

export function computeProducts(src: AnalyticsSource, r: DateRange): ProductStat[] {
  const m = new Map<string, { name: string; category: string; units: number; revenue: number; cost: number }>();
  let total = 0;
  for (const s of src.sales) {
    if (!inRange(s.at, r)) continue;
    for (const l of s.lines) {
      const p = m.get(l.code) ?? { name: l.product, category: l.category, units: 0, revenue: 0, cost: 0 };
      p.units += l.qty;
      p.revenue += l.qty * l.price;
      p.cost += l.qty * l.cost;
      total += l.qty * l.price;
      m.set(l.code, p);
    }
  }
  return [...m.entries()].map(([code, p]) => ({
    code,
    name: p.name,
    category: p.category,
    units: p.units,
    revenue: p.revenue,
    avgPrice: p.units ? p.revenue / p.units : 0,
    margin: p.revenue ? Math.round(((p.revenue - p.cost) / p.revenue) * 1000) / 10 : 0,
    share: total ? Math.round((p.revenue / total) * 1000) / 10 : 0,
  }));
}

export function computeExpenseCategories(src: AnalyticsSource, r: DateRange): { category: string; amount: number }[] {
  const m = new Map<string, number>();
  for (const e of src.expenses) if (inRange(e.date, r)) m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
  return [...m.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}

/** Percent change, or null when there is no baseline. */
export const pctChange = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
