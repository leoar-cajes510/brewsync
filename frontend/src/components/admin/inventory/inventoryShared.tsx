import Badge from '../../ui/Badge';
import type { StockStatus } from '../../../types/inventory';

export const STOCK_UNITS = ['units', 'pcs', 'cups', 'bottles', 'cartons', 'packs', 'bags', 'tins', 'kg', 'L'];

const statusBadge: Record<StockStatus, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  in: { label: 'In Stock', tone: 'success' },
  low: { label: 'Low Stock', tone: 'warning' },
  out: { label: 'Out of Stock', tone: 'danger' },
};

export function StockBadge({ status }: { status: StockStatus }) {
  return (
    <Badge tone={statusBadge[status].tone} dot>
      {statusBadge[status].label}
    </Badge>
  );
}

export function formatWhen(d: Date | null, now = new Date()): string {
  if (!d) return 'Never';
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return `Today · ${time}`;
  if (days === 1) return `Yesterday · ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${time}`;
}

/** Before → after preview used by restock and adjustment forms. */
export function StockPreview({ current, next, unit, label = 'New Stock' }: { current: number; next: number; unit: string; label?: string }) {
  const up = next >= current;
  return (
    <div className="stock-preview">
      <div className="stock-preview__box">
        <span>Current Stock</span>
        <strong>{current}</strong>
        <em>{unit}</em>
      </div>
      <div className={`stock-preview__box ${up ? 'stock-preview__box--up' : 'stock-preview__box--down'}`}>
        <span>{label}</span>
        <strong>{next}</strong>
        <em>
          {unit} ({up ? '+' : '−'}
          {Math.abs(next - current)})
        </em>
      </div>
    </div>
  );
}
