import { useMemo, useState } from 'react';
import { BarChart3, Download, Info, ReceiptText, ShoppingBag, TrendingUp, Wallet, Coins } from 'lucide-react';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Tabs from '../../components/ui/Tabs';
import Toggle from '../../components/ui/Toggle';
import SalesAnalytics from '../../components/admin/analytics/SalesAnalytics';
import OrderAnalytics, { ChannelSplits } from '../../components/admin/analytics/OrderAnalytics';
import ProductAnalytics from '../../components/admin/analytics/ProductAnalytics';
import ExpenseAnalytics from '../../components/admin/analytics/ExpenseAnalytics';
import InsightCards from '../../components/admin/analytics/InsightCards';
import { useSalesFeed } from '../../services/analyticsService';
import {
  computeExpenseCategories,
  computeHourly,
  computeKpis,
  computeProducts,
  computeSplits,
  computeTrend,
  dayCount,
  endOfDay,
  pctChange,
  presetRange,
  previousRange,
  shortDate,
  startOfDay,
  type DateRange,
  type RangePreset,
} from '../../components/admin/analytics/analyticsData';
import { useCatalog } from '../../stores/catalogStore';
import { stockStatus } from '../../types/inventory';
import { toISODate } from '../../types/expense';
import { formatPeso } from '../../utils/currency';
import '../../components/admin/analytics/analytics.css';

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'last30', label: 'Last 30 Days' },
  { value: 'custom', label: 'Custom Range' },
];

const parseInputDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// Detailed business analysis from persisted data: completed sales (net of refunds) and expenses
// come from GET /analytics/sales (BUSINESS-RULES §16); this page only aggregates them for display.
// Low-stock insight uses real inventory.
export default function AdminAnalyticsPage() {
  const { products, inventory } = useCatalog();
  const [preset, setPreset] = useState<RangePreset>('month');
  const [custom, setCustom] = useState(() => ({ from: toISODate(presetRange('last30').start), to: toISODate(new Date()) }));
  const [compare, setCompare] = useState(true);

  const today = toISODate(new Date());
  const customError = !custom.from || !custom.to ? 'Choose both dates.' : custom.from > custom.to ? '“From” must be on or before “To”.' : custom.to > today ? 'Range cannot end in the future.' : null;
  const range: DateRange = useMemo(() => {
    if (preset !== 'custom') return presetRange(preset);
    if (customError) return presetRange('month');
    return { start: startOfDay(parseInputDate(custom.from)), end: endOfDay(parseInputDate(custom.to)) };
  }, [preset, custom, customError]);
  // One request covers the range and the equal-length comparison period before it.
  const fetchRange = useMemo(() => ({ start: previousRange(range).start, end: range.end }), [range]);
  const { source, loading, error: feedError, reload } = useSalesFeed(fetchRange);
  const rangeLabel = dayCount(range) === 1 ? shortDate(range.start) : `${shortDate(range.start)} – ${shortDate(range.end)}`;

  const data = useMemo(() => {
    const kpis = computeKpis(source, range);
    const prevKpis = computeKpis(source, previousRange(range));
    return {
      kpis,
      prevKpis,
      trend: computeTrend(source, range, compare),
      hourly: computeHourly(source, range),
      splits: computeSplits(source, range),
      products: computeProducts(source, range),
      expenseCats: computeExpenseCategories(source, range),
    };
  }, [source, range, compare]);

  const lowStock = useMemo(
    () => products.filter((p) => inventory[p.id] && stockStatus(p.sellable, inventory[p.id].threshold) !== 'in').map((p) => ({ name: p.name, stock: p.sellable })),
    [products, inventory],
  );

  const { kpis, prevKpis } = data;
  const hasSales = kpis.orders > 0;
  const expenseTrend = compare ? pctChange(kpis.expenses, prevKpis.expenses) : null;

  const kpiCards = [
    { key: 'sales', label: 'Gross Sales', value: formatPeso(kpis.sales), delta: pctChange(kpis.sales, prevKpis.sales), good: 'up', icon: Coins, note: 'Recorded sales' },
    { key: 'orders', label: 'Orders', value: kpis.orders.toLocaleString(), delta: pctChange(kpis.orders, prevKpis.orders), good: 'up', icon: ShoppingBag, note: 'Completed transactions' },
    { key: 'aov', label: 'Avg Order Value', value: formatPeso(kpis.aov), delta: pctChange(kpis.aov, prevKpis.aov), good: 'up', icon: TrendingUp, note: 'Sales ÷ orders' },
    { key: 'expenses', label: 'Expenses', value: formatPeso(kpis.expenses), delta: pctChange(kpis.expenses, prevKpis.expenses), good: 'down', icon: ReceiptText, note: 'Recorded expenses' },
    { key: 'net', label: 'Est. Net Performance', value: formatPeso(kpis.net), delta: pctChange(kpis.net, prevKpis.net), good: 'up', icon: Wallet, note: 'Estimate: sales − expenses' },
  ];

  const exportCsv = () => {
    const rows = [['Period', 'Gross Sales', 'Orders'], ...data.trend.points.map((p) => [p.label, p.value.toFixed(2), String(p.orders)])];
    const blob = new Blob([`${source.isDemo ? '# DEMO DATA - not real business performance\n' : ''}${rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: `brewsync-analytics-${toISODate(range.start)}_${toISODate(range.end)}${source.isDemo ? '-DEMO' : ''}.csv` }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="admin-analytics">
      {feedError && (
        <div className="api-status api-status--error" role="alert">
          Could not load analytics: {feedError}
          <Button size="sm" onClick={reload}>
            Try again
          </Button>
        </div>
      )}
      {loading && !feedError && <span className="text-muted" role="status">Loading analytics…</span>}
      <section className="an-controls">
        <Tabs items={PRESETS} value={preset} onChange={(v) => setPreset(v as RangePreset)} />
        {preset === 'custom' && (
          <div className="an-custom">
            <Input aria-label="From date" type="date" max={today} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <span>to</span>
            <Input aria-label="To date" type="date" max={today} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            {customError && <span className="field__error">{customError}</span>}
          </div>
        )}
        <div className="an-controls__right">
          <Toggle checked={compare} onChange={setCompare} label="Compare to previous period" />
          <Button icon={<Download size={15} />} disabled={!hasSales} onClick={exportCsv}>
            Export
          </Button>
        </div>
      </section>

      {source.dataQuality && !source.dataQuality.complete && (
        <div className="an-banner" role="status">
          <Info size={16} />
          <span>
            <b>Cost and margin figures are partly estimated.</b>{' '}
            {[
              source.dataQuality.estimated ? `${source.dataQuality.estimated} line(s) predate cost snapshots and use today's recipe and costs` : '',
              source.dataQuality.missing ? `${source.dataQuality.missing} line(s) have no recipe, so their cost is unknown (shown as ₱0)` : '',
              source.dataQuality.incomplete ? `${source.dataQuality.incomplete} line(s) use an ingredient with no unit cost` : '',
            ]
              .filter(Boolean)
              .join('; ')}
            . Sales totals are exact.
          </span>
        </div>
      )}

      <div className="an-banner" role="status" hidden={hasSales}>
        <Info size={16} />
        <span>
          <b>Sales analytics is not available yet.</b> Sales, order, product and expense trends will appear here once the server-side analytics endpoints are connected. Nothing on this page is simulated.
        </span>
      </div>

      <section className="an-kpis" aria-label="Performance summary">
        {kpiCards.map(({ key, label, value, delta, good, icon: Icon, note }) => {
          const positive = delta !== null && (good === 'up' ? delta >= 0 : delta <= 0);
          return (
            <article key={key} className={`an-kpi ${key === 'net' ? 'an-kpi--net' : ''}`}>
              <div className="an-kpi__head">
                <span>
                  {label}
                  {source.isDemo && <em className="an-demo-tag">Demo</em>}
                </span>
                <Icon size={15} />
              </div>
              <strong className={`an-kpi__value ${key === 'net' && kpis.net < 0 ? 'an-neg' : ''}`}>{value}</strong>
              <p>
                {compare && delta !== null ? (
                  <b className={positive ? 'an-pos' : 'an-neg'}>
                    {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%
                  </b>
                ) : null}
                {compare && delta !== null ? ' vs prev · ' : ''}
                {note}
              </p>
            </article>
          );
        })}
      </section>

      <div className="an-grid">
        <div className="an-col">
          <SalesAnalytics points={data.trend.points} unit={data.trend.unit} compare={compare} rangeLabel={rangeLabel} />
          <OrderAnalytics stats={data.hourly} />
          <ProductAnalytics products={data.products} />
        </div>
        <div className="an-col an-col--side">
          <ChannelSplits channels={data.splits.channels} payments={data.splits.payments} />
          <ExpenseAnalytics grossSales={kpis.sales} categories={data.expenseCats} trend={expenseTrend} />
          <InsightCards products={data.products} hourly={data.hourly} expenseTrend={expenseTrend} lowStock={lowStock} trackedProducts={products.filter((p) => inventory[p.id]).length} isDemo={source.isDemo} />
        </div>
      </div>

      {!hasSales && (
        <p className="an-footnote">
          <BarChart3 size={13} /> Figures are calculated from real records only. Nothing shown here is estimated from sample data.
        </p>
      )}
    </div>
  );
}
