import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FolderTree, LayoutGrid, List, PackagePlus, Plus, SearchX } from 'lucide-react';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import EmptyState from '../../components/ui/EmptyState';
import Pagination from '../../components/ui/Pagination';
import SearchBar from '../../components/ui/SearchBar';
import Select from '../../components/ui/Select';
import Tabs from '../../components/ui/Tabs';
import ProductForm from '../../components/admin/products/ProductForm';
import ProductDetailsDrawer from '../../components/admin/products/ProductDetailsDrawer';
import CategoryManager from '../../components/admin/products/CategoryManager';
import ProductTable, { ProductGrid, productStatus, type ProductActions, type ProductStatus } from '../../components/admin/products/ProductTable';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import type { CatalogProduct, CatalogProductDraft } from '../../types/product';
import LoadingState from '../../components/ui/LoadingState';
import { errorMessage } from '../../services/api';
import { addProduct, duplicateProduct, loadCatalog, removeProduct, toggleProductActive, updateProduct, useCatalog } from '../../stores/catalogStore';
import { createCategory, listChoiceGroups, updateCategory } from '../../services/productService';
import '../../components/admin/products/products.css';

type StatusFilter = 'all' | ProductStatus;
type AvailabilityFilter = 'all' | 'available' | 'unavailable';
type FormTarget = { mode: 'add' } | { mode: 'edit'; product: CatalogProduct } | null;

const ALL = '__all__';

// The catalog starts EMPTY by design: a fresh business has no products until the
// owner adds them. Products are loaded from and saved to the API (shared catalog store,
// also read by Admin → Inventory and the POS).
export default function AdminProductsPage() {
  const { products, categories: categoryList, status: loadStatus, error: loadError } = useCatalog();
  const [choiceGroups, setChoiceGroups] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [managingCategories, setManagingCategories] = useState(false);

  useEffect(() => {
    listChoiceGroups()
      .then((groups) => setChoiceGroups(groups.map((g) => ({ id: g.id, name: g.name, active: g.active !== false }))))
      .catch(() => setChoiceGroups([]));
  }, []);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [availability, setAvailability] = useState<AvailabilityFilter>('all');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormTarget>(null);
  const [viewing, setViewing] = useState<CatalogProduct | null>(null);
  const [deleting, setDeleting] = useState<CatalogProduct | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort((a, b) => a.localeCompare(b)), [products]);
  /** Server categories for the product form (active ones are offered; a new name creates one). */
  const formCategories = useMemo(() => categoryList.map((c) => ({ name: c.name, codePrefix: c.code_prefix, active: c.active })), [categoryList]);

  const categoryTabs = [
    { value: ALL, label: 'All Categories', count: products.length },
    ...categories.map((c) => ({ value: c, label: c, count: products.filter((p) => p.category === c).length })),
  ];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    return products.filter(
      (p) =>
        (category === ALL || p.category === category) &&
        (status === 'all' || productStatus(p) === status) &&
        (availability === 'all' || (availability === 'available') === p.available) &&
        (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)),
    );
  }, [products, category, status, availability, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const from = filtered.length ? (currentPage - 1) * pageSize + 1 : 0;
  const to = Math.min(currentPage * pageSize, filtered.length);

  const resetPage = () => setPage(1);

  // Errors propagate to the form, which keeps it open and shows the server message.
  const save = async (draft: CatalogProductDraft) => {
    if (form?.mode === 'edit') {
      // Stock is owned by Inventory; editing a product never changes it.
      const { stock: _stock, ...catalogFields } = draft;
      await updateProduct(form.product.id, catalogFields);
      setFeedback(`Saved changes to ${draft.name}`);
    } else {
      const code = await addProduct(draft);
      setFeedback(`${draft.name} added to the catalog as #${code}`);
    }
    setForm(null);
  };

  const run = async (action: () => Promise<string | void>) => {
    setActionError(null);
    try {
      const message = await action();
      if (message) setFeedback(message);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const actions: ProductActions = {
    onView: setViewing,
    onEdit: (p) => {
      setViewing(null);
      setForm({ mode: 'edit', product: p });
    },
    onDuplicate: (p) =>
      // Stock starts at 0 for the copy; set it in Inventory.
      void run(async () => {
        const copy = await duplicateProduct(p);
        return copy ? `Duplicated as ${copy.name} (#${copy.code})` : undefined;
      }),
    onToggleActive: (p) =>
      void run(async () => {
        await toggleProductActive(p.id);
        return `${p.name} ${p.active ? 'deactivated' : 'activated'}`;
      }),
    onDelete: setDeleting,
  };

  const noProducts = products.length === 0;
  const emptyState = loadStatus === 'loading' && noProducts ? (
    <div className="products-empty">
      <LoadingState label="Loading products…" />
    </div>
  ) : loadStatus === 'error' && noProducts ? (
    <div className="products-empty">
      <EmptyState
        icon={<SearchX size={22} />}
        title="Could not load products"
        description={loadError}
        action={<Button onClick={() => void loadCatalog()}>Try again</Button>}
      />
    </div>
  ) : noProducts ? (
    <div className="products-empty">
      <EmptyState
        icon={<PackagePlus size={24} />}
        title="No products yet"
        description="Add your first menu item to start building your catalog."
        action={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setForm({ mode: 'add' })}>
            Add Product
          </Button>
        }
      />
    </div>
  ) : (
    <div className="products-empty">
      <EmptyState icon={<SearchX size={22} />} title="No products match" description="Try a different search, category, or filter." />
    </div>
  );

  return (
    <div className="admin-products">
      <div className="products-toolbar">
        <SearchBar
          className="products-toolbar__search"
          placeholder="Search products or codes…"
          shortcut="⌘K"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            resetPage();
          }}
        />
        <div className="products-toolbar__categories">
          <Tabs
            variant="chips"
            items={categoryTabs}
            value={category}
            onChange={(v) => {
              setCategory(v);
              resetPage();
            }}
          />
        </div>
        <div className="products-toolbar__actions">
          <Button icon={<Download size={15} />} disabled title="Available in a later phase">
            Export Catalog
          </Button>
          <Button icon={<FolderTree size={15} />} onClick={() => setManagingCategories(true)}>
            Categories
          </Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setForm({ mode: 'add' })}>
            Add Product
          </Button>
        </div>
      </div>

      <div className="products-subbar">
        <label className="inline-filter">
          <span>Status:</span>
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              resetPage();
            }}
            options={[
              { value: 'all', label: 'All Statuses' },
              { value: 'active', label: 'Active' },
              { value: 'low', label: 'Low Stock' },
              { value: 'out', label: 'Out of Stock' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />
        </label>
        <label className="inline-filter">
          <span>Availability:</span>
          <Select
            aria-label="Availability"
            value={availability}
            onChange={(e) => {
              setAvailability(e.target.value as AvailabilityFilter);
              resetPage();
            }}
            options={[
              { value: 'all', label: 'All Availability' },
              { value: 'available', label: 'Available' },
              { value: 'unavailable', label: 'Unavailable' },
            ]}
          />
        </label>
        <span className="products-subbar__count">
          Showing <strong>{filtered.length}</strong> of {products.length} {products.length === 1 ? 'item' : 'items'}
        </span>
        <div className="view-toggle" role="group" aria-label="View">
          <button type="button" className={view === 'list' ? 'view-toggle__btn view-toggle__btn--active' : 'view-toggle__btn'} aria-pressed={view === 'list'} aria-label="List view" onClick={() => setView('list')}>
            <List size={16} />
          </button>
          <button type="button" className={view === 'grid' ? 'view-toggle__btn view-toggle__btn--active' : 'view-toggle__btn'} aria-pressed={view === 'grid'} aria-label="Grid view" onClick={() => setView('grid')}>
            <LayoutGrid size={16} />
          </button>
        </div>
      </div>

      <div className="products-card">
        {view === 'list' ? (
          <ProductTable products={pageRows} actions={actions} empty={emptyState} />
        ) : (
          <ProductGrid products={pageRows} actions={actions} empty={emptyState} />
        )}
        {!noProducts && (
          <footer className="products-card__footer">
            <label className="inline-filter">
              <span>Rows per page:</span>
              <Select
                aria-label="Rows per page"
                value={String(pageSize)}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  resetPage();
                }}
                options={[10, 25, 50].map((n) => ({ value: String(n), label: String(n) }))}
              />
            </label>
            <span className="products-card__range">
              {from}–{to} of {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
            </span>
            <div className="products-card__pages">
              <Pagination page={currentPage} pageCount={pageCount} onChange={setPage} />
            </div>
          </footer>
        )}
      </div>

      {form && (
        <ProductForm
          key={form.mode === 'edit' ? form.product.id : 'new'}
          product={form.mode === 'edit' ? form.product : undefined}
          categories={formCategories}
          choiceGroups={choiceGroups}
          onCancel={() => setForm(null)}
          onSubmit={save}
        />
      )}

      <CategoryManager
        open={managingCategories}
        categories={categoryList}
        onClose={() => setManagingCategories(false)}
        onCreate={async (name, codePrefix) => {
          await createCategory(name, codePrefix);
          await loadCatalog();
          setFeedback(`Category ${name} (${codePrefix}) added`);
        }}
        onUpdate={async (id, patch) => {
          await updateCategory(id, patch);
          await loadCatalog();
          setFeedback(patch.active === undefined ? 'Category renamed' : `Category ${patch.active ? 'activated' : 'deactivated'}`);
        }}
      />

      <ProductDetailsDrawer product={viewing} onClose={() => setViewing(null)} onEdit={actions.onEdit} />

      <ConfirmDialog
        open={deleting !== null}
        danger
        title={`Delete ${deleting?.name ?? 'product'}?`}
        message="This permanently removes the product. Only a product that was never sold or stocked can be deleted; otherwise deactivate it instead."
        confirmLabel="Delete Product"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) {
            const target = deleting;
            void run(async () => {
              await removeProduct(target.id);
            });
          }
          setDeleting(null);
        }}
      />

      {actionError && (
        <div className="products-feedback">
          <div className="api-status api-status--error" role="alert">
            {actionError}
            <Button size="sm" onClick={() => setActionError(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {feedback && (
        <div className="products-feedback">
          <ActionFeedback message={feedback} onDone={clearFeedback} />
        </div>
      )}
    </div>
  );
}
