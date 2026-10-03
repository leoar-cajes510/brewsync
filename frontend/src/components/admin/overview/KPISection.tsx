import type { LucideIcon } from 'lucide-react';
import { Banknote, ReceiptText, ShoppingBag, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import type { Kpi } from '../../../pages/Admin/adminOverviewData';

const icons: Record<Kpi['id'], LucideIcon> = {
  sales: Banknote,
  orders: ReceiptText,
  average: ShoppingBag,
  expenses: Wallet,
};

export default function KPISection({ kpis }: { kpis: Kpi[] }) {
  return (
    <section className="kpi-grid" aria-label="Key metrics">
      {kpis.map((kpi) => {
        const Icon = icons[kpi.id];
        const Trend = kpi.trend?.direction === 'down' ? TrendingDown : TrendingUp;
        return (
          <article key={kpi.id} className="kpi-card">
            <div className="kpi-card__head">
              <span className="kpi-card__label">{kpi.label}</span>
              <span className="kpi-card__icon">
                <Icon size={17} />
              </span>
            </div>
            <strong className="kpi-card__value">{kpi.value}</strong>
            <p className="kpi-card__detail">
              {kpi.trend && (
                <span className={`kpi-card__trend kpi-card__trend--${kpi.trend.direction}`}>
                  <Trend size={14} /> {kpi.trend.text}
                </span>
              )}
              {kpi.detail}
            </p>
          </article>
        );
      })}
    </section>
  );
}
