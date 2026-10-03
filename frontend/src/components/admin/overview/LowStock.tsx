import { Link } from 'react-router-dom';
import EmptyState from '../../ui/EmptyState';

interface LowStockItem {
  name: string;
  location: string;
  left: number;
  unit: string;
}

export default function LowStock({ items }: { items: LowStockItem[] }) {
  return (
    <section className="ov-card">
      <header className="ov-card__header">
        <div className="ov-card__title-row">
          <h2 className="ov-card__title">Low Stock</h2>
          <span className="low-stock__dot" aria-hidden="true" />
        </div>
        <Link to="/admin/inventory" className="ov-link">
          View Inventory
        </Link>
      </header>
      {items.length === 0 ? (
        <EmptyState title="No low-stock products" description="Tracked products at or below their threshold appear here." />
      ) : (
        <ul className="low-stock">
          {items.map((item) => (
            <li key={item.name} className="low-stock__row">
              <div>
                <strong>{item.name}</strong>
                <span>{item.location}</span>
              </div>
              <span className={`low-stock__qty ${item.left <= 2 ? 'low-stock__qty--critical' : ''}`}>
                {item.left} {item.unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
