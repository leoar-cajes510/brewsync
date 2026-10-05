import { Package, Pencil, Trash2 } from 'lucide-react';
import Badge from '../../ui/Badge';
import Table, { type TableColumn } from '../../ui/Table';
import { StockBadge, formatWhen } from '../inventory/inventoryShared';
import { stockStatus } from '../../../types/inventory';
import { formatUnitCost, type Ingredient } from '../../../types/ingredient';

interface IngredientTableProps {
  ingredients: Ingredient[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRestock: (ingredient: Ingredient) => void;
  onAdjust: (ingredient: Ingredient) => void;
  onEdit: (ingredient: Ingredient) => void;
  onDelete: (ingredient: Ingredient) => void;
  empty: React.ReactNode;
}

export default function IngredientTable({ ingredients, selectedId, onSelect, onRestock, onAdjust, onEdit, onDelete, empty }: IngredientTableProps) {
  const columns: TableColumn<Ingredient>[] = [
    {
      key: 'name',
      header: 'Ingredient Name & Code',
      width: '28%',
      render: (i) => (
        <div className="ing-name">
          <span className="ing-name__icon">
            <Package size={15} />
          </span>
          <div className="ing-name__text">
            <strong>{i.name}</strong>
            <span>
              #{i.code} · {i.category}
            </span>
          </div>
        </div>
      ),
    },
    { key: 'unit', header: 'Unit', width: '6%', render: (i) => <span className="ing-strong">{i.unit}</span> },
    {
      key: 'qty',
      header: 'Quantity On Hand',
      width: '17%',
      render: (i) => {
        const s = (i.status ?? stockStatus(i.stock, i.threshold));
        // Bar is relative to 3× the threshold (a comfortable level) for display only.
        const pct = Math.min(100, (i.stock / Math.max(i.threshold * 3, 1)) * 100);
        return (
          <div className={`ing-qty ing-qty--${s}`}>
            <div className="ing-qty__row">
              <strong>
                {i.stock} {i.unit}
              </strong>
              <span>{Math.round(pct)}%</span>
            </div>
            {(i.reserved ?? 0) > 0 && (
              <span className="ing-muted" title="Reserved for open orders; available = on hand − reserved">
                {i.reserved} reserved
              </span>
            )}
            <span className="ing-qty__track">
              <span className="ing-qty__bar" style={{ width: `${i.stock > 0 ? Math.max(pct, 5) : 0}%` }} />
            </span>
          </div>
        );
      },
    },
    { key: 'cost', header: 'Cost / Unit', width: '11%', align: 'right', render: (i) => <span className="ing-strong">{formatUnitCost(i.cost)} / {i.unit}</span> },
    { key: 'threshold', header: 'Threshold', width: '9%', align: 'right', render: (i) => <span className="ing-muted">{i.threshold} {i.unit}</span> },
    {
      key: 'status',
      header: 'Status',
      width: '11%',
      // A deactivated ingredient is not used by recipes; say so instead of a stock level.
      render: (i) => {
        if (i.active === false) return <Badge tone="neutral">Inactive</Badge>;
        const s = i.status ?? stockStatus(i.stock, i.threshold);
        const used = i.usedBy ?? [];
        return (
          <div className="ing-status">
            <StockBadge status={s} />
            {used.length > 0 && s !== 'in' && (
              <span className="ing-muted ing-status__affects" title={`Used by: ${used.join(', ')}`}>
                Affects {used.length} product{used.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        );
      },
    },
    { key: 'updated', header: 'Last Updated', width: '10%', render: (i) => <span className="ing-muted">{formatWhen(i.updatedAt)}</span> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      width: '17%',
      render: (i) => {
        const s = (i.status ?? stockStatus(i.stock, i.threshold));
        return (
          <div className="ing-actions" onClick={(e) => e.stopPropagation()}>
            <button type="button" className={`ing-act ing-act--${s}`} onClick={() => onRestock(i)}>
              {s === 'out' ? 'Restock Now' : 'Restock'}
            </button>
            <button type="button" className="ing-act" onClick={() => onAdjust(i)}>
              Stock…
            </button>
            <button type="button" className="icon-btn" aria-label={`Edit ${i.name}`} title="Edit" onClick={() => onEdit(i)}>
              <Pencil size={14} />
            </button>
            <button type="button" className="icon-btn ing-delete" aria-label={`Delete ${i.name}`} title="Delete" onClick={() => onDelete(i)}>
              <Trash2 size={14} />
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="ing-table">
      <Table
        columns={columns}
        rows={ingredients}
        rowKey={(i) => i.id}
        onRowClick={(i) => onSelect(i.id)}
        rowClassName={(i) => [i.id === selectedId && 'ing-row--selected', i.active === false && 'ing-row--inactive', (i.status ?? stockStatus(i.stock, i.threshold)) === 'out' && 'ing-row--out'].filter(Boolean).join(' ') || undefined}
        empty={empty}
      />
    </div>
  );
}
