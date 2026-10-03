import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Eye, ImageOff, MoreVertical, Pencil, Power, Trash2 } from 'lucide-react';
import Badge from '../../ui/Badge';
import Table, { type TableColumn } from '../../ui/Table';
import type { CatalogProduct } from '../../../types/product';
import { formatPeso } from '../../../utils/currency';
import { DEFAULT_LOW_STOCK_THRESHOLD, getThreshold } from '../../../stores/catalogStore';

export type ProductStatus = 'active' | 'low' | 'out' | 'inactive';

// Low stock uses the per-item threshold set in Admin → Inventory.
export function productStatus(p: CatalogProduct): ProductStatus {
  if (!p.active) return 'inactive';
  if (!p.trackUnits) return 'active';
  if (p.stock <= 0) return 'out';
  if (p.stock <= getThreshold(p.id)) return 'low';
  return 'active';
}

const statusBadge = {
  active: { label: 'Active', tone: 'success' },
  low: { label: 'Low Stock', tone: 'warning' },
  out: { label: 'Out of Stock', tone: 'danger' },
  inactive: { label: 'Inactive', tone: 'neutral' },
} as const;

export function formatUpdated(d: Date, now = new Date()): string {
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

export interface ProductActions {
  onView: (p: CatalogProduct) => void;
  onEdit: (p: CatalogProduct) => void;
  onDuplicate: (p: CatalogProduct) => void;
  onToggleActive: (p: CatalogProduct) => void;
  onDelete: (p: CatalogProduct) => void;
}

export function ProductThumb({ product, size = 'sm' }: { product: CatalogProduct; size?: 'sm' | 'lg' }) {
  return (
    <span className={`product-thumb product-thumb--${size}`}>
      {product.image ? <img src={product.image} alt="" /> : <ImageOff size={size === 'sm' ? 16 : 28} />}
    </span>
  );
}

export function StockLevel({ stock, threshold = DEFAULT_LOW_STOCK_THRESHOLD, tracked = true }: { stock: number; threshold?: number; tracked?: boolean }) {
  if (!tracked) return <span className="stock-level__text">Not tracked</span>;
  const state = stock <= 0 ? 'out' : stock <= threshold ? 'low' : 'ok';
  // Bar scales to a nominal 50 units for display only.
  const pct = Math.min(100, (stock / 50) * 100);
  return (
    <span className={`stock-level stock-level--${state}`}>
      <span className="stock-level__track">
        <span className="stock-level__bar" style={{ width: `${Math.max(pct, stock > 0 ? 6 : 0)}%` }} />
      </span>
      <span className="stock-level__text">{state === 'low' ? `${stock} left` : `${stock} in stock`}</span>
    </span>
  );
}

/** Row "⋮" menu, rendered in a portal so the table's scroll box never clips it. */
function RowMenu({ product, actions }: { product: CatalogProduct; actions: ProductActions }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    const r = btnRef.current!.getBoundingClientRect();
    const menuHeight = 190;
    const top = r.bottom + menuHeight > window.innerHeight ? r.top - menuHeight - 4 : r.bottom + 4;
    setPos({ top, left: r.right - 200 });
    setOpen((o) => !o);
  };

  const item = (label: string, icon: React.ReactNode, run: () => void, danger = false) => (
    <button
      type="button"
      role="menuitem"
      className={`row-menu__item ${danger ? 'row-menu__item--danger' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <>
      <button ref={btnRef} type="button" className="row-action" aria-label={`More actions for ${product.name}`} aria-haspopup="menu" aria-expanded={open} onMouseDown={(e) => e.stopPropagation()} onClick={toggle}>
        <MoreVertical size={16} />
      </button>
      {open &&
        createPortal(
          <div className="row-menu" role="menu" style={{ top: pos.top, left: pos.left }} onMouseDown={(e) => e.stopPropagation()}>
            {item('View Details', <Eye size={15} />, () => actions.onView(product))}
            {item('Duplicate', <Copy size={15} />, () => actions.onDuplicate(product))}
            {item(product.active ? 'Deactivate' : 'Activate', <Power size={15} />, () => actions.onToggleActive(product))}
            <div className="row-menu__sep" />
            {item('Delete', <Trash2 size={15} />, () => actions.onDelete(product), true)}
          </div>,
          document.body,
        )}
    </>
  );
}

interface ProductTableProps {
  products: CatalogProduct[];
  actions: ProductActions;
  empty: React.ReactNode;
}

export default function ProductTable({ products, actions, empty }: ProductTableProps) {
  const columns: TableColumn<CatalogProduct>[] = [
    {
      key: 'product',
      header: 'Product',
      width: '30%',
      render: (p) => (
        <div className={`product-cell ${!p.available || !p.active ? 'product-cell--muted' : ''}`}>
          <ProductThumb product={p} />
          <div className="product-cell__text">
            <div className="product-cell__title">
              <strong>{p.name}</strong>
              <span className="code-chip">#{p.code}</span>
            </div>
            <span className="product-cell__desc">{p.description || 'No description'}</span>
          </div>
        </div>
      ),
    },
    { key: 'category', header: 'Category', width: '13%', render: (p) => <span className="cell-strong">{p.category}</span> },
    { key: 'price', header: 'Price', align: 'right', width: '9%', render: (p) => <strong className={!p.available ? 'cell-struck' : undefined}>{formatPeso(p.price)}</strong> },
    { key: 'stock', header: 'Stock Level', width: '14%', render: (p) => <StockLevel stock={p.stock} threshold={getThreshold(p.id)} tracked={p.trackUnits} /> },
    {
      key: 'availability',
      header: 'Availability',
      align: 'center',
      width: '10%',
      render: (p) => (
        <Badge tone={p.available ? 'success' : 'neutral'} dot>
          {p.available ? 'Available' : 'Unavailable'}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '9%',
      render: (p) => {
        const s = statusBadge[productStatus(p)];
        return <Badge tone={s.tone}>{s.label}</Badge>;
      },
    },
    { key: 'updated', header: 'Updated', width: '9%', render: (p) => <span className="cell-muted">{formatUpdated(p.updatedAt)}</span> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      width: '6%',
      render: (p) => (
        <div className="row-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="row-action" aria-label={`Edit ${p.name}`} title="Edit" onClick={() => actions.onEdit(p)}>
            <Pencil size={15} />
          </button>
          <RowMenu product={p} actions={actions} />
        </div>
      ),
    },
  ];

  return (
    <div className="products-table">
      <Table
        columns={columns}
        rows={products}
        rowKey={(p) => p.id}
        onRowClick={actions.onView}
        rowClassName={(p) => (!p.available || !p.active ? 'product-row--muted' : undefined)}
        empty={empty}
      />
    </div>
  );
}

export function ProductGrid({ products, actions, empty }: ProductTableProps) {
  if (products.length === 0) return <>{empty}</>;
  return (
    <div className="products-grid">
      {products.map((p) => {
        const s = statusBadge[productStatus(p)];
        return (
          <article key={p.id} className={`products-grid__card ${!p.available || !p.active ? 'products-grid__card--muted' : ''}`} onClick={() => actions.onView(p)}>
            <div className="products-grid__media">
              {p.image ? <img src={p.image} alt="" /> : <ImageOff size={28} />}
              <span className="code-chip products-grid__code">#{p.code}</span>
            </div>
            <div className="products-grid__body">
              <span className="products-grid__category">{p.category}</span>
              <strong>{p.name}</strong>
              <div className="products-grid__meta">
                <span>{formatPeso(p.price)}</span>
                <Badge tone={s.tone}>{s.label}</Badge>
              </div>
              <StockLevel stock={p.stock} threshold={getThreshold(p.id)} tracked={p.trackUnits} />
            </div>
            <div className="products-grid__actions" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="row-action" aria-label={`Edit ${p.name}`} onClick={() => actions.onEdit(p)}>
                <Pencil size={15} />
              </button>
              <RowMenu product={p} actions={actions} />
            </div>
          </article>
        );
      })}
    </div>
  );
}
