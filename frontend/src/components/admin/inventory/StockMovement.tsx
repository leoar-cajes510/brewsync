import { History } from 'lucide-react';
import EmptyState from '../../ui/EmptyState';
import type { StockMovement as Movement, StockMovementType } from '../../../types/inventory';

const typeLabel: Record<StockMovementType, string> = {
  initial: 'Initial Stock',
  restock: 'Restock Intake',
  adjustment: 'Adjustment',
  correction: 'Count Correction',
  sale: 'Point of Sale Order',
};

interface StockMovementProps {
  movements: Movement[];
  unit: string;
  /** Show only the most recent N (panel); omit for the full log. */
  limit?: number;
}

export default function StockMovement({ movements, unit, limit }: StockMovementProps) {
  const rows = limit ? movements.slice(0, limit) : movements;
  if (rows.length === 0) return <EmptyState icon={<History size={20} />} title="No stock movements yet" />;

  return (
    <ol className="movement-log">
      {rows.map((m) => (
        <li key={m.id} className="movement">
          <div className="movement__top">
            <span className={`movement__delta ${m.delta > 0 ? 'movement__delta--up' : m.delta < 0 ? 'movement__delta--down' : ''}`}>
              {m.delta > 0 ? `+${m.delta}` : m.delta}
            </span>
            <strong>{m.type === 'adjustment' && m.reason ? `${m.reason}` : typeLabel[m.type]}</strong>
            <time>{m.at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time>
          </div>
          <span className="movement__meta">
            Balance {m.balanceAfter} {unit}
            {m.note ? ` · ${m.note}` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}
