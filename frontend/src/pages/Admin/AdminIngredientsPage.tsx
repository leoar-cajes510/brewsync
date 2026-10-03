import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, Package, Plus, SearchX, Wallet } from 'lucide-react';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import EmptyState from '../../components/ui/EmptyState';
import Pagination from '../../components/ui/Pagination';
import SearchBar from '../../components/ui/SearchBar';
import Select from '../../components/ui/Select';
import Tabs from '../../components/ui/Tabs';
import IngredientTable from '../../components/admin/ingredients/IngredientTable';
import IngredientForm from '../../components/admin/ingredients/IngredientForm';
import IngredientStock, { type StockChange, type StockMode } from '../../components/admin/ingredients/IngredientStock';
import RecipeEditor from '../../components/admin/ingredients/RecipeEditor';
import LoadingState from '../../components/ui/LoadingState';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import { errorMessage } from '../../services/api';
import * as inventoryApi from '../../services/inventoryService';
import type { IngredientDto, IngredientUnitDto, StockMovementDto } from '../../types/api';
import { useCatalog } from '../../stores/catalogStore';
import { stockStatus, type StockStatus } from '../../types/inventory';
import { formatPeso } from '../../utils/currency';
import type { Ingredient, IngredientDraft, IngredientMovement, RecipeBook, RecipeLine } from '../../types/ingredient';
import '../../components/admin/products/products.css';
import '../../components/admin/inventory/inventory.css';
import '../../components/admin/ingredients/ingredients.css';

const ALL = '__all__';
const PAGE_SIZE = 10;

const STATUS: Record<string, StockStatus> = { in_stock: 'in', low: 'low', out: 'out' };

function fromDto(d: IngredientDto): Ingredient {
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    category: d.category,
    unit: d.unit,
    stock: Number(d.stock?.on_hand ?? 0),
    cost: Number(d.unit_cost),
    threshold: Number(d.stock?.low_stock_threshold ?? 0),
    notes: d.notes,
    active: d.active,
    status: d.stock ? STATUS[d.stock.status] : undefined,
    updatedAt: new Date(),
    movements: [],
  };
}

const MOVEMENT_TYPE: Record<string, IngredientMovement['type']> = { initial: 'initial', restock: 'restock' };

function movementFromDto(m: StockMovementDto): IngredientMovement {
  return {
    id: m.id,
    type: MOVEMENT_TYPE[m.type] ?? 'adjustment',
    delta: Number(m.delta_on_hand),
    balanceAfter: Number(m.on_hand_after),
    reason: m.reason ?? (MOVEMENT_TYPE[m.type] ? undefined : m.type),
    note: m.note ?? undefined,
    at: new Date(m.created_at),
  };
}

/** Next free ING-NN code; the server still enforces uniqueness (409 CONFLICT). */
function nextCode(list: Ingredient[]): string {
  const max = list.reduce((m, i) => Math.max(m, Number(/^ING-(\d+)$/.exec(i.code)?.[1] ?? 0)), 0);
  return `ING-${String(max + 1).padStart(2, '0')}`;
}

/** UI reason → server stock action (restock / adjust / correct / waste). Stock math stays on the server. */
function stockRequest(change: StockChange): { action: 'restock' | 'adjust' | 'correct' | 'waste'; body: Record<string, string | undefined> } {
  const note = [change.reason, change.note].filter(Boolean).join(' · ') || undefined;
  const qty = String(Math.abs(change.delta));
  if (change.mode === 'restock') return { action: 'restock', body: { quantity: qty, note } };
  if (change.reason === 'Count Correction') return { action: 'correct', body: { delta: String(change.delta), reason: 'Count correction', note: change.note || undefined } };
  if (change.reason === 'Spoilage / Expired' && change.delta < 0) return { action: 'waste', body: { quantity: qty, note: change.note || undefined } };
  const reason = change.reason === 'Damaged' ? 'damaged' : change.reason === 'Lost' ? 'lost' : 'other';
  return { action: 'adjust', body: { delta: String(change.delta), reason, note } };
}

// Raw materials + product recipes (GET/POST/PATCH /ingredients, stock movements, recipes).
// Ingredients are never deleted (Q-DEL-1): remove = deactivate. Units are fixed once created
// (unit conversion ⚠ OPEN Q-ING-4); cost figures are estimates only (costing ⚠ OPEN Q-ING-3).
export default function AdminIngredientsPage() {
  const { products } = useCatalog();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<RecipeBook>({});
  // Products whose recipe is deducted on every sale (product.track_ingredients).
  const [deducting, setDeducting] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const [status, setStatus] = useState<'all' | StockStatus>('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [movements, setMovements] = useState<IngredientMovement[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [stockFor, setStockFor] = useState<{ ingredient: Ingredient; mode: StockMode } | null>(null);
  const [deleting, setDeleting] = useState<Ingredient | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const refresh = useCallback(async () => {
    try {
      setIngredients((await inventoryApi.listIngredients()).map(fromDto));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const productIds = products.map((p) => p.id).join(',');
  useEffect(() => {
    if (!productIds) return;
    let cancelled = false;
    void Promise.all(productIds.split(',').map((id) => inventoryApi.getRecipe(id).catch(() => null))).then((list) => {
      if (cancelled) return;
      const book: RecipeBook = {};
      setDeducting(Object.fromEntries(list.filter((r) => r !== null).map((r) => [r!.product_id, r!.track_ingredients === true])));
      for (const r of list) {
        if (r && r.lines.length) book[r.product_id] = r.lines.map((l, i) => ({ id: `rl-${r.product_id}-${i}`, ingredientId: l.ingredient_id, quantity: Number(l.quantity) }));
      }
      setRecipes(book);
    });
    return () => {
      cancelled = true;
    };
  }, [productIds]);

  const loadMovements = useCallback(async (id: string | null) => {
    if (!id) return setMovements([]);
    try {
      setMovements((await inventoryApi.ingredientMovements(id)).map(movementFromDto).reverse());
    } catch (err) {
      setMovements([]);
      setFeedback(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadMovements(selectedId);
  }, [selectedId, loadMovements]);

  const categories = useMemo(() => [...new Set(ingredients.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [ingredients]);
  const statusOf = (i: Ingredient) => i.status ?? stockStatus(i.stock, i.threshold);
  const counts = useMemo(() => {
    const s = ingredients.map((i) => i.status ?? stockStatus(i.stock, i.threshold));
    return {
      total: ingredients.length,
      low: s.filter((x) => x === 'low').length,
      out: s.filter((x) => x === 'out').length,
      value: ingredients.reduce((sum, i) => sum + i.stock * i.cost, 0),
    };
  }, [ingredients]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ingredients.filter(
      (i) =>
        (category === ALL || i.category === category) &&
        (status === 'all' || statusOf(i) === status) &&
        (!q || i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q) || i.notes.toLowerCase().includes(q)),
    );
  }, [ingredients, query, category, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const selectedBase = ingredients.find((i) => i.id === selectedId) ?? null;
  const selected = selectedBase ? { ...selectedBase, movements } : null;

  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      await refresh();
      setFeedback(message);
      return true;
    } catch (err) {
      setFeedback(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async (draft: IngredientDraft) => {
    if (busy) return;
    if (editing) {
      if (draft.unit !== editing.unit) {
        setFeedback('The unit of an existing ingredient cannot be changed (recipes are stored in it).');
        return;
      }
      const target = editing;
      const ok = await run(async () => {
        await inventoryApi.updateIngredient(target.id, { name: draft.name, category: draft.category, unit_cost: String(draft.cost), notes: draft.notes });
        if (draft.threshold !== target.threshold) await inventoryApi.setIngredientThreshold(target.id, String(draft.threshold));
      }, `${draft.name} updated`);
      if (ok) {
        setFormOpen(false);
        setEditing(null);
      }
    } else {
      let createdId = '';
      const ok = await run(async () => {
        const created = await inventoryApi.createIngredient({
          code: nextCode(ingredients),
          name: draft.name,
          category: draft.category,
          unit: draft.unit as IngredientUnitDto,
          unit_cost: String(draft.cost),
          notes: draft.notes,
          initial_stock: String(draft.stock),
          low_stock_threshold: String(draft.threshold),
        });
        createdId = created.id;
      }, `${draft.name} added`);
      if (ok) {
        setSelectedId(createdId);
        setFormOpen(false);
      }
    }
  };

  const applyStock = async (ing: Ingredient, change: StockChange) => {
    if (busy) return;
    const { action, body } = stockRequest(change);
    const ok = await run(() => inventoryApi.moveIngredient(ing.id, action, body), `${ing.name}: stock updated`);
    if (ok) {
      setStockFor(null);
      setSelectedId(ing.id);
      void loadMovements(ing.id);
    }
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    void run(() => inventoryApi.updateIngredient(target.id, { active: !target.active }), `${target.name} ${target.active ? 'deactivated' : 'reactivated'}`);
  };

  const saveRecipe = (productId: string, lines: RecipeLine[], deduct: boolean) => {
    const name = products.find((p) => p.id === productId)?.name ?? 'product';
    void run(async () => {
      const saved = await inventoryApi.saveRecipe(productId, lines.map((l) => ({ ingredient_id: l.ingredientId, quantity: String(l.quantity) })), deduct);
      setDeducting((d) => ({ ...d, [productId]: saved.track_ingredients === true }));
      setRecipes((book) => ({ ...book, [productId]: saved.lines.map((l, i) => ({ id: `rl-${productId}-${i}`, ingredientId: l.ingredient_id, quantity: Number(l.quantity) })) }));
    }, `Recipe saved for ${name}`);
  };

  const usedIn = (ing: Ingredient) => Object.values(recipes).filter((lines) => lines.some((l) => l.ingredientId === ing.id)).length;

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const kpis = [
    { key: 'total', label: 'Total Ingredients', value: String(counts.total), sub: `Across ${categories.length} ${categories.length === 1 ? 'category' : 'categories'}`, icon: Package, tone: '' },
    { key: 'low', label: 'Low Stock Alert', value: String(counts.low), sub: 'At or below threshold', icon: AlertTriangle, tone: 'warning', tag: counts.low ? 'Needs Review' : '' },
    { key: 'out', label: 'Out of Stock', value: String(counts.out), sub: 'Requires restock', icon: Ban, tone: 'danger', tag: counts.out ? 'Critical' : '' },
    { key: 'value', label: 'Raw Material Value', value: formatPeso(counts.value), sub: 'Stock × cost per unit (estimate)', icon: Wallet, tone: 'success' },
  ];

  const noIngredients = ingredients.length === 0;

  return (
    <div className="admin-ingredients">
      <section className="ing-kpis" aria-label="Ingredients summary">
        {kpis.map(({ key, label, value, sub, icon: Icon, tone, tag }) => (
          <article key={key} className={`ing-kpi ${tone ? `ing-kpi--${tone}` : ''}`}>
            <div>
              <span className="ing-kpi__label">
                {label} {tag && <em>{tag}</em>}
              </span>
              <strong className="ing-kpi__value">{value}</strong>
              <p>{sub}</p>
            </div>
            <span className="ing-kpi__icon">
              <Icon size={18} />
            </span>
          </article>
        ))}
      </section>

      <div className="ing-layout">
        <section className="ing-main">
          <div className="ing-toolbar">
            <SearchBar
              className="ing-toolbar__search"
              placeholder="Search ingredients, code, notes…"
              aria-label="Search ingredients"
              value={query}
              onChange={(e) => resetPage(setQuery)(e.target.value)}
            />
            <div className="ing-toolbar__actions">
              <Select
                className="ing-toolbar__status"
                aria-label="Filter by stock status"
                value={status}
                onChange={(e) => resetPage(setStatus)(e.target.value as typeof status)}
                options={[
                  { value: 'all', label: 'All Statuses' },
                  { value: 'in', label: 'In Stock' },
                  { value: 'low', label: 'Low Stock' },
                  { value: 'out', label: 'Out of Stock' },
                ]}
              />
              <Button variant="primary" icon={<Plus size={16} />} onClick={openAdd}>
                Add Ingredient
              </Button>
            </div>
          </div>
          {!noIngredients && (
            <div className="ing-chips">
              <Tabs
                variant="chips"
                items={[{ value: ALL, label: 'All', count: ingredients.length }, ...categories.map((c) => ({ value: c, label: c, count: ingredients.filter((i) => i.category === c).length }))]}
                value={category}
                onChange={resetPage(setCategory)}
              />
            </div>
          )}

          {loading ? (
            <LoadingState label="Loading ingredients…" />
          ) : loadError ? (
            <EmptyState title="Could not load ingredients" description={loadError} action={<Button onClick={() => void refresh()}>Try again</Button>} />
          ) : (
          <IngredientTable
            ingredients={rows}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRestock={(ingredient) => setStockFor({ ingredient, mode: 'restock' })}
            onAdjust={(ingredient) => setStockFor({ ingredient, mode: 'adjust' })}
            onEdit={(i) => {
              setEditing(i);
              setFormOpen(true);
            }}
            onDelete={setDeleting}
            empty={
              noIngredients ? (
                <EmptyState
                  icon={<Package size={22} />}
                  title="No ingredients yet"
                  description="Add your first ingredient to begin tracking raw materials and recipes."
                  action={
                    <Button variant="primary" icon={<Plus size={16} />} onClick={openAdd}>
                      Add Ingredient
                    </Button>
                  }
                />
              ) : (
                <EmptyState icon={<SearchX size={22} />} title="No ingredients match" description="Try a different search, category, or stock status." />
              )
            }
          />
          )}

          {!noIngredients && (
            <footer className="ing-footer">
              <span>
                Showing {filtered.length ? (current - 1) * PAGE_SIZE + 1 : 0}–{Math.min(current * PAGE_SIZE, filtered.length)} of {filtered.length} items
              </span>
              <Pagination page={current} pageCount={pageCount} onChange={setPage} />
            </footer>
          )}
        </section>

        <RecipeEditor products={products} ingredients={ingredients} recipes={recipes} deducting={deducting} logIngredient={selected} onSave={saveRecipe} />
      </div>

      <IngredientForm
        open={formOpen}
        ingredient={editing}
        categories={categories}
        existingNames={ingredients.filter((i) => i.id !== editing?.id).map((i) => i.name)}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSave={(d) => void save(d)}
      />
      <IngredientStock ingredient={stockFor?.ingredient ?? null} mode={stockFor?.mode ?? 'restock'} onClose={() => setStockFor(null)} onApply={(ing, change) => void applyStock(ing, change)} />
      <ConfirmDialog
        open={deleting !== null}
        title={deleting?.active === false ? 'Reactivate ingredient?' : 'Deactivate ingredient?'}
        message={
          deleting &&
          (deleting.active === false
            ? `“${deleting.name}” will be available for recipes and stock again.`
            : `Ingredients cannot be deleted because stock history references them. “${deleting.name}” will be deactivated${usedIn(deleting) ? ` (used in ${usedIn(deleting)} recipe${usedIn(deleting) === 1 ? '' : 's'})` : ''}; you can reactivate it later.`)
        }
        confirmLabel={deleting?.active === false ? 'Reactivate' : 'Deactivate'}
        danger={deleting?.active !== false}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}
