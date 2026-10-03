import { ReceiptText } from 'lucide-react';
import EmptyState from '../../ui/EmptyState';
import { formatPeso } from '../../../utils/currency';

interface ExpenseAnalyticsProps {
  grossSales: number;
  categories: { category: string; amount: number }[];
  /** Change in total expenses vs the previous period, % (null = no baseline). */
  trend: number | null;
}

// Net margin composition: gross sales minus recorded expenses by category.
// An estimate only — no COGS, tax or accounting adjustments.
export default function ExpenseAnalytics({ grossSales, categories, trend }: ExpenseAnalyticsProps) {
  const totalExpenses = categories.reduce((s, c) => s + c.amount, 0);
  const net = grossSales - totalExpenses;
  const margin = grossSales > 0 ? Math.round((net / grossSales) * 100) : null;
  const maxCat = Math.max(1, ...categories.map((c) => c.amount));

  return (
    <section className="an-card an-card--side">
      <header className="an-card__head">
        <h2>Net Margin Composition</h2>
        {margin !== null && totalExpenses > 0 && <span className={`an-margin ${margin < 0 ? 'an-margin--neg' : ''}`}>{margin}% Margin</span>}
      </header>

      {categories.length === 0 && grossSales === 0 ? (
        <EmptyState icon={<ReceiptText size={22} />} title="No expense data yet" description="Record expenses to begin analyzing business spending." />
      ) : (
        <div className="an-net">
          <div className="an-net__row an-net__row--gross">
            <span>Gross Sales</span>
            <strong>{formatPeso(grossSales)}</strong>
          </div>
          {categories.length === 0 ? (
            <p className="an-net__none">No expenses recorded in this period.</p>
          ) : (
            categories.map((c) => (
              <div key={c.category} className="an-net__row an-net__row--exp">
                <span>
                  <i className="an-dot an-dot--neg" />
                  {c.category}
                </span>
                <span className="an-net__bar">
                  <span style={{ width: `${(c.amount / maxCat) * 100}%` }} />
                </span>
                <strong>−{formatPeso(c.amount)}</strong>
              </div>
            ))
          )}
          <div className="an-net__row an-net__row--total">
            <span>Est. Net Profit</span>
            <strong className={net < 0 ? 'an-neg' : ''}>{formatPeso(net)}</strong>
          </div>
          <p className="an-net__note">
            Total expenses {formatPeso(totalExpenses)}
            {trend !== null && (
              <>
                {' '}
                · <b className={trend > 0 ? 'an-neg' : 'an-pos'}>{trend > 0 ? '▲' : '▼'} {Math.abs(trend)}%</b> vs previous period
              </>
            )}
            . Estimate only (sales − recorded expenses).
          </p>
        </div>
      )}
    </section>
  );
}
