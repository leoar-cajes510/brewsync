import { Link } from 'react-router-dom';
import EmptyState from '../../ui/EmptyState';
import { formatPeso } from '../../../utils/currency';

interface BestSeller {
  name: string;
  sold: number;
  revenue: number;
}

export default function BestSellers({ items }: { items: BestSeller[] }) {
  const max = Math.max(...items.map((i) => i.sold));
  return (
    <section className="ov-card">
      <header className="ov-card__header">
        <h2 className="ov-card__title">Best Selling Products</h2>
        <Link to="/admin/products" className="ov-link">
          View Products
        </Link>
      </header>
      {items.length === 0 ? (
        <EmptyState title="No sales data yet" description="Products sold this month appear here." />
      ) : (
        <ol className="best-sellers">
          {items.map((item, i) => (
            <li key={item.name} className="best-seller">
              <div className="best-seller__row">
                <span className="best-seller__name">
                  <span className="best-seller__rank">{String(i + 1).padStart(2, '0')}</span>
                  {item.name}
                </span>
                <span className="best-seller__stat">
                  {item.sold} sold · {formatPeso(item.revenue).replace('.00', '')}
                </span>
              </div>
              <div className="best-seller__track" aria-hidden="true">
                <div className="best-seller__bar" style={{ width: `${(item.sold / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
