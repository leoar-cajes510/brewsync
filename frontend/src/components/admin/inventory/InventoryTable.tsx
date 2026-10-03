import { Plus, SlidersHorizontal } from 'lucide-react';
import Table, { type TableColumn } from '../../ui/Table';
import { ProductThumb } from '../products/ProductTable';
import { StockBadge, formatWhen } from './inventoryShared';
import { stockStatus } from '../../../types/inventory';
import type { RestockItem } from './RestockModal';

interface InventoryTableProps {
  items: RestockItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRestock: (id: string) => void;
  onAdjust: (id: string) => void;
  empty: React.ReactNode;
}

export default function InventoryTable({ items, selectedId, onSelect, onRestock, onAdjust, empty }: InventoryTableProps) {
  const columns: TableColumn<RestockItem>[] = [
    {
      key: 'product',
      header: 'Product',
      width: '27%',
      render: ({ product }) => (
        <div className="inv-product">
          <ProductThumb product={product} />
          <div className="inv-product__text">
            <div className="inv-product__title">
              <strong>{product.name}</strong>
              <span className="code-chip">#{product.code}</span>
            </div>
            <span className="inv-product__sub">{product.active ? (product.available ? 'On POS menu' : 'Hidden from POS') : 'Inactive product'}</span>
          </div>
        </div>
      ),
    },
    { key: 'category', header: 'Category', width: '14%', render: ({ product }) => <span className="inv-strong">{product.category}</span> },
    {
      key: 'stock',
      header: 'Current Stock',
      width: '14%',
      render: ({ product, record }) => {
        const s = stockStatus(product.stock, record.threshold);
        // Bar is relative to 3× the threshold (a "comfortably stocked" level) for display only.
        const pct = Math.min(100, (product.stock / Math.max(record.threshold * 3, 1)) * 100);
        return (
          <div className={`inv-stock inv-stock--${s}`}>
            <div className="inv-stock__row">
              <strong>{product.stock}</strong>
              <span>{record.unit}</span>
            </div>
            <span className="inv-stock__track">
              <span className="inv-stock__bar" style={{ width: `${product.stock > 0 ? Math.max(pct, 6) : 0}%` }} />
            </span>
          </div>
        );
      },
    },
    { key: 'threshold', header: 'Threshold', width: '10%', render: ({ record }) => <span className="inv-muted">{record.threshold} {record.unit}</span> },
    { key: 'status', header: 'Status', width: '11%', render: ({ product, record }) => <StockBadge status={stockStatus(product.stock, record.threshold)} /> },
    { key: 'restocked', header: 'Last Restocked', width: '12%', render: ({ record }) => <span className="inv-muted">{formatWhen(record.lastRestockedAt)}</span> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      width: '12%',
      render: ({ product, record }) => {
        const out = stockStatus(product.stock, record.threshold) === 'out';
        return (
          <div className="inv-actions" onClick={(e) => e.stopPropagation()}>
            <button type="button" className={`inv-restock ${out ? 'inv-restock--urgent' : ''}`} onClick={() => onRestock(product.id)}>
              <Plus size={13} /> Restock
            </button>
            <button type="button" className="inv-adjust" aria-label={`Adjust ${product.name}`} onClick={() => onAdjust(product.id)}>
              <SlidersHorizontal size={13} /> Adjust
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="inv-table">
      <Table
        columns={columns}
        rows={items}
        rowKey={(i) => i.product.id}
        onRowClick={(i) => onSelect(i.product.id)}
        rowClassName={(i) => (i.product.id === selectedId ? 'inv-row--selected' : undefined)}
        empty={empty}
      />
    </div>
  );
}
