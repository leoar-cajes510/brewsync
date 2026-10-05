import { useCallback, useEffect, useMemo, useState } from 'react';
import { downloadCsv, isoDate } from '../../utils/csv';
import { printHtml, stockTagHtml } from '../../utils/kitchenTicket';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Ban, Boxes, Download, PackageOpen, Printer, SearchX, ShoppingCart, SlidersHorizontal, Warehouse, X } from 'lucide-react';
import Button from '../../components/ui/Button';
import Drawer from '../../components/ui/Drawer';
import EmptyState from '../../components/ui/EmptyState';
import LoadingState from '../../components/ui/LoadingState';
import Pagination from '../../components/ui/Pagination';
import SearchBar from '../../components/ui/SearchBar';
import Select from '../../components/ui/Select';
import Tabs from '../../components/ui/Tabs';
import InventoryTable from '../../components/admin/inventory/InventoryTable';
import RestockModal, { RestockForm, type RestockItem } from '../../components/admin/inventory/RestockModal';
import StockAdjustment, { type AdjustmentPreset } from '../../components/admin/inventory/StockAdjustment';
import StockMovement from '../../components/admin/inventory/StockMovement';
import { ProductThumb } from '../../components/admin/products/ProductTable';
import { StockBadge } from '../../components/admin/inventory/inventoryShared';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import { errorMessage } from '../../services/api';
import { adjustStock, loadCatalog, loadMovements, restock, setThreshold, useCatalog, type AdjustmentReason } from '../../stores/catalogStore';
import { stockStatus, type StockStatus } from '../../types/inventory';
import '../../components/admin/products/products.css';
import '../../components/admin/inventory/inventory.css';

const ALL = '__all__';
const PAGE_SIZE = 10;

// Inventory manages stock for products created in Admin → Products (tracked products
// only). It never creates products itself. Levels come from GET /inventory; restock and
// adjustments go through the inventory API (idempotent, server-validated).
export default function AdminInventoryPage() {
  const navigate = useNavigate();
  const { products, inventory, status: loadStatus, error: loadError } = useCatalog();
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const [status, setStatus] = useState<'all' | StockStatus>('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restockFor, setRestockFor] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<AdjustmentPreset | null>(null);
  const [fullLog, setFullLog] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const items: RestockItem[] = useMemo(
    () => products.filter((p) => inventory[p.id]).map((p) => ({ product: p, record: inventory[p.id] })),
    [products, inventory],
  );

  const categories = useMemo(() => [...new Set(items.map((i) => i.product.category))].sort((a, b) => a.localeCompare(b)), [items]);
  const counts = useMemo(() => {
    const s = items.map((i) => stockStatus(i.product.sellable, i.record.threshold));
    return {
      total: items.length,
      active: items.filter((i) => i.product.active).length,
      low: s.filter((x) => x === 'low').length,
      out: s.filter((x) => x === 'out').length,
      units: items.reduce((sum, i) => sum + i.product.stock, 0),
    };
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    return items.filter(
      ({ product, record }) =>
        (category === ALL || product.category === category) &&
        (status === 'all' || stockStatus(product.sellable, record.threshold) === status) &&
        (!q || product.name.toLowerCase().includes(q) || product.code.toLowerCase().includes(q)),
    );
  }, [items, category, status, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Default the side panel to the first visible item.
  const selected = items.find((i) => i.product.id === selectedId) ?? filtered[0] ?? null;
  const selectedProductId = selected?.product.id ?? null;
  useEffect(() => {
    if (selectedProductId) loadMovements(selectedProductId).catch((err) => setActionError(errorMessage(err)));
  }, [selectedProductId]);

  const doRestock = async (id: string, qty: number, unit: string, note: string) => {
    setActionError(null);
    setSelectedId(id);
    try {
      await restock(id, qty, unit, note || undefined);
      const name = items.find((i) => i.product.id === id)?.product.name;
      setFeedback(`Restocked ${name} +${qty} ${unit}`);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  // Low-stock threshold editor in the details panel (PATCH /inventory/{id}).
  const [thresholdText, setThresholdText] = useState<string | null>(null);
  useEffect(() => setThresholdText(null), [selectedId]);
  const saveThreshold = async (id: string) => {
    const value = Number(thresholdText);
    if (thresholdText === null || thresholdText.trim() === '' || !Number.isFinite(value) || value < 0) {
      setActionError('Enter a low-stock threshold of 0 or more.');
      return;
    }
    setActionError(null);
    try {
      await setThreshold(id, value);
      setThresholdText(null);
      setFeedback(`Low-stock threshold set to ${value}`);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const doAdjust = async (id: string, delta: number, reason: AdjustmentReason, note: string) => {
    setActionError(null);
    setSelectedId(id);
    try {
      await adjustStock(id, delta, reason, note || undefined);
      const name = items.find((i) => i.product.id === id)?.product.name;
      setFeedback(`${name}: ${delta > 0 ? '+' : ''}${delta} (${reason})`);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const noItems = items.length === 0;
  const emptyState = loadStatus === 'loading' && noItems ? (
    <div className="inv-empty">
      <LoadingState label="Loading inventory…" />
    </div>
  ) : loadStatus === 'error' && noItems ? (
    <div className="inv-empty">
      <EmptyState
        icon={<SearchX size={22} />}
        title="Could not load inventory"
        description={loadError}
        action={<Button onClick={() => void loadCatalog()}>Try again</Button>}
      />
    </div>
  ) : noItems ? (
    <div className="inv-empty">
      <EmptyState
        icon={<PackageOpen size={24} />}
        title="No inventory items yet"
        description="Add products with stock tracking first to begin managing stock levels."
        action={
          <Button variant="primary" onClick={() => navigate('/admin/products')}>
            Go to Products
          </Button>
        }
      />
    </div>
  ) : (
    <div className="inv-empty">
      <EmptyState icon={<SearchX size={22} />} title="No items match" description="Try a different search, category, or stock status." />
    </div>
  );

  const kpis = [
    { key: 'total', label: 'Total Products', value: counts.total, note: `${counts.active} active`, sub: `Across ${categories.length} ${categories.length === 1 ? 'category' : 'categories'}`, icon: Boxes, tone: '' },
    { key: 'low', label: 'Low Stock', value: counts.low, note: 'Restock Req.', sub: 'At or below threshold', icon: AlertTriangle, tone: 'warning' },
    { key: 'out', label: 'Out of Stock', value: counts.out, note: 'Checkout Blocked', sub: 'Requires immediate restock', icon: Ban, tone: 'danger' },
    { key: 'units', label: 'Units On Hand', value: counts.units, note: 'total', sub: 'Sum of current stock', icon: Warehouse, tone: '' },
  ];

  return (
    <div className={`admin-inventory ${noItems ? 'admin-inventory--empty' : ''}`}>
      <div className="inv-main">
        <section className="inv-kpis" aria-label="Inventory summary">
          {kpis.map(({ key, label, value, note, sub, icon: Icon, tone }) => (
            <article key={key} className={`inv-kpi ${tone ? `inv-kpi--${tone}` : ''}`}>
              <div className="inv-kpi__head">
                <span>{label}</span>
                <Icon size={16} />
              </div>
              <div className="inv-kpi__value">
                <strong>{value}</strong>
                <em>{note}</em>
              </div>
              <p>{sub}</p>
            </article>
          ))}
        </section>

        <section className="inv-filters">
          <div className="inv-filters__row">
            <SearchBar
              className="inv-filters__search"
              placeholder="Search inventory by product name or code…"
              shortcut="⌘K"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
            <Select
              aria-label="Stock status"
              className="inv-filters__status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as 'all' | StockStatus);
                setPage(1);
              }}
              options={[
                { value: 'all', label: 'All Statuses' },
                { value: 'in', label: 'In Stock' },
                { value: 'low', label: 'Low Stock' },
                { value: 'out', label: 'Out of Stock' },
              ]}
            />
            <div className="inv-filters__actions">
              <Button
                icon={<Download size={15} />}
                disabled={!filtered.length}
                title="Export the listed stock levels (CSV)"
                onClick={() =>
                  downloadCsv(
                    `brewsync-inventory-${isoDate()}.csv`,
                    ['Code', 'Name', 'Category', 'On Hand', 'Available', 'Reserved', 'Low-Stock Threshold', 'Status'],
                    filtered.map(({ product, record }) => [
                      product.code, product.name, product.category, product.stock, product.sellable,
                      Math.max(0, product.stock - product.sellable), record.threshold, stockStatus(product.sellable, record.threshold),
                    ]),
                  )
                }
              >
                Export Inventory
              </Button>
              <Button variant="primary" icon={<SlidersHorizontal size={15} />} disabled={noItems} onClick={() => selected && setAdjust({ productId: selected.product.id })}>
                Stock Adjustment
              </Button>
            </div>
          </div>
          <Tabs
            variant="chips"
            items={[
              { value: ALL, label: 'All Categories', count: items.length },
              ...categories.map((c) => ({ value: c, label: c, count: items.filter((i) => i.product.category === c).length })),
            ]}
            value={category}
            onChange={(v) => {
              setCategory(v);
              setPage(1);
            }}
          />
        </section>

        <section className="inv-card">
          <InventoryTable
            items={pageRows}
            selectedId={selected?.product.id ?? null}
            onSelect={setSelectedId}
            onRestock={(id) => {
              setSelectedId(id);
              setRestockFor(id);
            }}
            onAdjust={(id) => {
              setSelectedId(id);
              setAdjust({ productId: id });
            }}
            empty={emptyState}
          />
          {!noItems && (
            <footer className="inv-card__footer">
              <span>
                Showing <strong>{filtered.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}</strong> to <strong>{Math.min(currentPage * PAGE_SIZE, filtered.length)}</strong> of {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
              </span>
              <Pagination page={currentPage} pageCount={pageCount} onChange={setPage} />
            </footer>
          )}
        </section>
      </div>

      {!noItems && (
        <aside className="inv-panel" aria-label="Quick restock and audit">
          {selected ? (
            <>
              <header className="inv-panel__header">
                <div>
                  <div className="inv-panel__title-row">
                    <h2>Quick Restock &amp; Audit</h2>
                    <span className="code-chip inv-panel__code">#{selected.product.code}</span>
                  </div>
                  <p>Restock, adjust, and review stock movement.</p>
                </div>
                <button type="button" className="icon-btn inv-panel__close" aria-label="Clear selection" onClick={() => setSelectedId(null)}>
                  <X size={15} />
                </button>
              </header>

              <div className="inv-panel__body">
                <div className="inv-panel__product">
                  <ProductThumb product={selected.product} />
                  <div>
                    <span className="inv-panel__category">{selected.product.category}</span>
                    <strong>{selected.product.name}</strong>
                    {thresholdText === null ? (
                      <span className="inv-panel__threshold">
                        Threshold: {selected.record.threshold} {selected.record.unit} · Available to sell: {selected.product.sellable}{' '}
                        <button type="button" className="link-btn" onClick={() => setThresholdText(String(selected.record.threshold))}>
                          Edit threshold
                        </button>
                      </span>
                    ) : (
                      <span className="inv-panel__threshold">
                        <input
                          className="input input--sm"
                          aria-label="Low-stock threshold"
                          inputMode="decimal"
                          value={thresholdText}
                          onChange={(e) => setThresholdText(e.target.value)}
                          style={{ width: 90 }}
                        />{' '}
                        <Button size="sm" variant="primary" onClick={() => void saveThreshold(selected.product.id)}>
                          Save
                        </Button>{' '}
                        <Button size="sm" onClick={() => setThresholdText(null)}>
                          Cancel
                        </Button>
                      </span>
                    )}
                  </div>
                  <StockBadge status={stockStatus(selected.product.sellable, selected.record.threshold)} />
                </div>

                {actionError && (
                  <div className="api-status api-status--error" role="alert">
                    {actionError}
                  </div>
                )}
                <RestockForm
                  key={selected.product.id}
                  items={items}
                  productId={selected.product.id}
                  lockProduct
                  compact
                  onConfirm={(...args) => void doRestock(...args)}
                />

                <Button
                  block
                  className="inv-loss-btn"
                  icon={<ShoppingCart size={15} />}
                  disabled={selected.product.stock === 0}
                  onClick={() => setAdjust({ productId: selected.product.id, direction: 'decrease', reason: 'Damaged' })}
                >
                  Record Loss / Shrinkage
                </Button>

                <div className="inv-panel__log-head">
                  <span>Stock Movement Log</span>
                  <button type="button" className="link-btn" onClick={() => setFullLog(true)}>
                    Full Log
                  </button>
                </div>
                <StockMovement movements={selected.record.movements} unit={selected.record.unit} limit={4} />
              </div>

              <footer className="inv-panel__footer">
                <Button icon={<SlidersHorizontal size={15} />} onClick={() => setAdjust({ productId: selected.product.id })}>
                  Stock Adjustment
                </Button>
                <Button
                  icon={<Printer size={15} />}
                  title="Print a shelf tag with the product code and name"
                  onClick={() => printHtml(stockTagHtml(selected.product))}
                >
                  Print Stock Tag
                </Button>
              </footer>
            </>
          ) : (
            <div className="inv-panel__empty">
              <EmptyState icon={<Boxes size={22} />} title="No item selected" description="Select an inventory item to restock it or review its movements." />
            </div>
          )}
        </aside>
      )}

      <RestockModal
        key={restockFor ?? 'none'}
        open={restockFor !== null}
        items={items}
        initialProductId={restockFor}
        onClose={() => setRestockFor(null)}
        onConfirm={(...args) => void doRestock(...args)}
      />

      {adjust && (
        <StockAdjustment
          items={items}
          preset={adjust}
          onClose={() => setAdjust(null)}
          onApply={(id, delta, reason, note) => void doAdjust(id, delta, reason, note)}
        />
      )}

      <Drawer open={fullLog && selected !== null} onClose={() => setFullLog(false)} title={selected ? `Movement Log · ${selected.product.name}` : 'Movement Log'}>
        {selected && <StockMovement movements={selected.record.movements} unit={selected.record.unit} />}
      </Drawer>

      {feedback && (
        <div className="products-feedback">
          <ActionFeedback message={feedback} onDone={clearFeedback} />
        </div>
      )}
    </div>
  );
}
