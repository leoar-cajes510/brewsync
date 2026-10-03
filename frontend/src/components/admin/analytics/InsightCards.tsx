import { useNavigate } from 'react-router-dom';
import { AlertTriangle, BadgeCheck, Clock, Sparkles, TrendingDown, TrendingUp, Turtle } from 'lucide-react';
import type { HourlyStats, ProductStat } from './analyticsData';

export interface InsightInput {
  products: ProductStat[];
  hourly: HourlyStats;
  /** Expense change vs previous period, % (null = no baseline). */
  expenseTrend: number | null;
  /** Real low-stock products from Admin → Products / Inventory. */
  lowStock: { name: string; stock: number }[];
  /** How many real products have stock tracked in Inventory. */
  trackedProducts: number;
  isDemo: boolean;
}

interface Insight {
  key: string;
  title: string;
  text: string | null;
  tone: 'good' | 'info' | 'warn' | 'bad';
  icon: typeof Sparkles;
  link?: { label: string; to: string };
}

const hourText = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`;

// Each card states a finding only when the data supports it; otherwise it says
// "Not enough data yet". No conclusions are invented.
export default function InsightCards({ products, hourly, expenseTrend, lowStock, trackedProducts, isDemo }: InsightInput) {
  const navigate = useNavigate();
  const byUnits = [...products].sort((a, b) => b.units - a.units);
  const best = byUnits[0];
  const slow = products.length >= 3 ? byUnits[byUnits.length - 1] : undefined;
  const peak = hourly.total ? hourly.counts.indexOf(Math.max(...hourly.counts)) : -1;

  const insights: Insight[] = [
    { key: 'best', title: 'Best Seller', icon: BadgeCheck, tone: 'good', text: best ? `${best.name} leads with ${best.units} units sold (${best.share}% of revenue).` : null },
    {
      key: 'slow',
      title: 'Slow Mover',
      icon: Turtle,
      tone: 'info',
      text: slow ? `${slow.name} sold only ${slow.units} units this period. Consider reviewing its recipe, price or placement.` : null,
      link: slow ? { label: 'Products', to: '/admin/products' } : undefined,
    },
    {
      key: 'peak',
      title: 'Peak Hour',
      icon: Clock,
      tone: 'info',
      text: peak >= 0 ? `${hourText(7 + peak)} is the busiest hour with ${hourly.counts[peak]} orders (${Math.round((hourly.counts[peak] / hourly.total) * 100)}% of volume).` : null,
    },
    {
      key: 'stock',
      title: 'Low Stock',
      icon: AlertTriangle,
      tone: lowStock.length ? 'bad' : 'good',
      text: !trackedProducts
        ? null
        : !lowStock.length
          ? `All ${trackedProducts} tracked product${trackedProducts === 1 ? ' is' : 's are'} above their low-stock threshold.`
          : lowStock.length
        ? `${lowStock.length} product${lowStock.length === 1 ? ' is' : 's are'} low or out of stock: ${lowStock
            .slice(0, 3)
            .map((p) => `${p.name} (${p.stock})`)
            .join(', ')}${lowStock.length > 3 ? '…' : ''}.`
        : null,
      link: lowStock.length ? { label: 'Inventory', to: '/admin/inventory' } : undefined,
    },
    {
      key: 'expense',
      title: 'Expense Trend',
      icon: expenseTrend !== null && expenseTrend > 0 ? TrendingUp : TrendingDown,
      tone: expenseTrend !== null && expenseTrend > 0 ? 'warn' : 'good',
      text: expenseTrend !== null ? `Spending is ${expenseTrend > 0 ? 'up' : 'down'} ${Math.abs(expenseTrend)}% vs the previous period.` : null,
    },
  ];

  const available = insights.filter((i) => i.text).length;

  return (
    <section className="an-card an-card--side">
      <header className="an-card__head">
        <h2>Business Insights</h2>
        <Sparkles size={16} className="an-muted" />
      </header>
      {available === 0 && <p className="an-insights__empty">No insights available yet — more business activity is needed to generate insights.</p>}
      <ul className="an-insights">
        {insights.map(({ key, title, text, tone, icon: Icon, link }) => (
          <li key={key} className={`an-insight ${text ? `an-insight--${tone}` : 'an-insight--none'}`}>
            <Icon size={18} />
            <div>
              <strong>
                {title}
                {text && isDemo && key !== 'stock' && <em className="an-demo-tag">Demo</em>}
              </strong>
              <span>{text ?? 'Not enough data yet'}</span>
            </div>
            {link && (
              <button type="button" className="an-insight__link" onClick={() => navigate(link.to)}>
                {link.label} →
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
