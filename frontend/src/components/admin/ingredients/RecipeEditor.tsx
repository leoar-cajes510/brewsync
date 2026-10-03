import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Info, PlusCircle, Trash2, Workflow } from 'lucide-react';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import EmptyState from '../../ui/EmptyState';
import Select from '../../ui/Select';
import Tabs from '../../ui/Tabs';
import Toggle from '../../ui/Toggle';
import { ProductThumb } from '../products/ProductTable';
import { formatWhen } from '../inventory/inventoryShared';
import { formatPeso } from '../../../utils/currency';
import type { CatalogProduct } from '../../../types/product';
import { formatUnitCost, roundQty, type Ingredient, type RecipeBook, type RecipeLine } from '../../../types/ingredient';

let lineSeq = 0;
const newLine = (): RecipeLine => ({ id: `rl-${++lineSeq}`, ingredientId: '', quantity: 0 });

interface DraftLine {
  id: string;
  ingredientId: string;
  qty: string;
}

const toDraft = (lines: RecipeLine[]): DraftLine[] => lines.map((l) => ({ id: l.id, ingredientId: l.ingredientId, qty: String(l.quantity) }));

interface RecipeEditorProps {
  products: CatalogProduct[];
  ingredients: Ingredient[];
  recipes: RecipeBook;
  /** product id → recipe deducted on every sale (product.track_ingredients). */
  deducting: Record<string, boolean>;
  /** Ingredient whose stock history the "Stock Log" tab shows. */
  logIngredient: Ingredient | null;
  onSave: (productId: string, lines: RecipeLine[], deduct: boolean) => void;
}

// Product → Recipe → Ingredients → quantities. Products come from Admin → Products
// (read-only here). Recipes are saved via PUT /products/{id}/recipe.
export default function RecipeEditor({ products, ingredients, recipes, deducting, logIngredient, onSave }: RecipeEditorProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'recipe' | 'log'>('recipe');
  const [productId, setProductId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [pendingProduct, setPendingProduct] = useState<string | null>(null);
  const [deduct, setDeduct] = useState(false);

  const product = products.find((p) => p.id === productId) ?? null;
  const saved = useMemo(() => (productId ? toDraft(recipes[productId] ?? []) : []), [productId, recipes]);
  const savedDeduct = productId ? deducting[productId] === true : false;
  const dirty =
    deduct !== savedDeduct ||
    JSON.stringify(lines.map(({ ingredientId, qty }) => [ingredientId, Number(qty)])) !== JSON.stringify(saved.map(({ ingredientId, qty }) => [ingredientId, Number(qty)]));

  // Drop a selection whose product was deleted in Admin → Products.
  useEffect(() => {
    if (productId && !product) setProductId('');
  }, [productId, product]);

  // Drop draft lines whose ingredient was deleted.
  useEffect(() => {
    const ids = new Set(ingredients.map((i) => i.id));
    setLines((ls) => (ls.some((l) => l.ingredientId && !ids.has(l.ingredientId)) ? ls.filter((l) => !l.ingredientId || ids.has(l.ingredientId)) : ls));
  }, [ingredients]);

  const load = (id: string) => {
    setProductId(id);
    setLines(toDraft(recipes[id] ?? []));
    setDeduct(deducting[id] === true);
    setSubmitted(false);
  };

  const chooseProduct = (id: string) => (dirty && id !== productId ? setPendingProduct(id) : load(id));

  const byId = useMemo(() => Object.fromEntries(ingredients.map((i) => [i.id, i])), [ingredients]);
  const lineErrors = lines.map((l) => (!byId[l.ingredientId] ? 'Choose an ingredient.' : !(Number(l.qty) > 0) ? 'Enter a quantity greater than 0.' : undefined));
  const estCost = lines.reduce((sum, l) => sum + (byId[l.ingredientId] ? byId[l.ingredientId].cost * (Number(l.qty) || 0) : 0), 0);
  const margin = product && product.price > 0 ? Math.round(((product.price - estCost) / product.price) * 1000) / 10 : null;

  const update = (id: string, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const save = () => {
    setSubmitted(true);
    if (!product || lineErrors.some(Boolean)) return;
    onSave(
      product.id,
      lines.map((l) => ({ id: l.id, ingredientId: l.ingredientId, quantity: roundQty(Number(l.qty)) })),
      deduct && lines.length > 0,
    );
    setSubmitted(false);
  };

  const recipeCount = (id: string) => recipes[id]?.length ?? 0;

  const body = () => {
    if (products.length === 0)
      return (
        <EmptyState
          icon={<BookOpen size={22} />}
          title="No products to build recipes for"
          description="Recipes link products from Admin → Products to the ingredients they use."
          action={<Button onClick={() => navigate('/admin/products')}>Go to Products</Button>}
        />
      );
    return (
      <>
        <Select
          label="Product"
          value={productId}
          onChange={(e) => chooseProduct(e.target.value)}
          placeholder="Select a product…"
          options={products.map((p) => ({ value: p.id, label: `${p.name} (#${p.code})${recipeCount(p.id) ? ` · ${recipeCount(p.id)} ingredient${recipeCount(p.id) === 1 ? '' : 's'}` : ''}` }))}
        />
        {!product ? (
          <p className="recipe__hint">Choose a product to create or edit its recipe.</p>
        ) : (
          <>
            <div className="recipe__product">
              <ProductThumb product={product} />
              <div>
                <strong>{product.name}</strong>
                <span className="code-chip">#{product.code}</span>
                <em>{formatPeso(product.price)} base price</em>
              </div>
            </div>
            <div className="recipe__cost">
              <span>Estimated cost / serving</span>
              <strong>{formatPeso(estCost)}</strong>
              {margin !== null && lines.length > 0 && <em className={margin < 0 ? 'recipe__margin--neg' : ''}>{margin}% margin</em>}
            </div>

            <div className="recipe__head">
              <strong>Recipe Composition ({lines.length} {lines.length === 1 ? 'ingredient' : 'ingredients'})</strong>
              {dirty && <span className="recipe__unsaved">Unsaved changes</span>}
            </div>
            {ingredients.length === 0 ? (
              <p className="recipe__hint">Add ingredients first — they will appear here to use in recipes.</p>
            ) : (
              <div className="recipe__lines">
                {lines.length === 0 && <p className="recipe__hint">No ingredients in this recipe yet.</p>}
                {lines.map((l, i) => {
                  const ing = byId[l.ingredientId];
                  const taken = new Set(lines.filter((x) => x.id !== l.id).map((x) => x.ingredientId));
                  const err = submitted ? lineErrors[i] : undefined;
                  return (
                    <div key={l.id} className={`recipe-line ${err ? 'recipe-line--error' : ''}`}>
                      <div className="recipe-line__main">
                        <select
                          className="input select recipe-line__ingredient"
                          aria-label={`Recipe ingredient ${i + 1}`}
                          value={l.ingredientId}
                          onChange={(e) => update(l.id, { ingredientId: e.target.value })}
                        >
                          <option value="">Select ingredient…</option>
                          {ingredients
                            .filter((x) => !taken.has(x.id))
                            .map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name} (#{x.code})
                              </option>
                            ))}
                        </select>
                        <label className="recipe-line__qty">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            placeholder="0"
                            aria-label={`Recipe quantity ${i + 1}`}
                            value={l.qty === '0' ? '' : l.qty}
                            onChange={(e) => update(l.id, { qty: e.target.value })}
                          />
                          <span>{ing?.unit ?? 'unit'}</span>
                        </label>
                        <button type="button" className="icon-btn recipe-line__remove" aria-label={`Remove recipe ingredient ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="recipe-line__meta">
                        {ing ? (
                          <>
                            <span>
                              {formatUnitCost(ing.cost)}/{ing.unit} · {ing.stock} {ing.unit} on hand
                            </span>
                            <strong>{formatPeso(ing.cost * (Number(l.qty) || 0))}</strong>
                          </>
                        ) : (
                          <span>Pick an ingredient and the quantity used per serving</span>
                        )}
                      </div>
                      {err && <span className="field__error">{err}</span>}
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="recipe__add"
                  disabled={lines.length >= ingredients.length}
                  onClick={() => setLines((ls) => [...ls, { ...toDraft([newLine()])[0], qty: '' }])}
                >
                  <PlusCircle size={15} /> Add Ingredient to Recipe
                </button>
              </div>
            )}

            <div className="recipe__logic">
              <span className="recipe__logic-title">
                <Workflow size={14} /> Deduction Preview
              </span>
              <p>
                {lines.some((l) => byId[l.ingredientId] && Number(l.qty) > 0)
                  ? `1 × ${product.name} would use ${lines
                      .filter((l) => byId[l.ingredientId] && Number(l.qty) > 0)
                      .map((l) => `${Number(l.qty)} ${byId[l.ingredientId].unit} ${byId[l.ingredientId].name}`)
                      .join(', ')}.`
                  : 'Add ingredients to preview what one serving uses.'}
              </p>
              <Toggle checked={deduct} disabled={lines.length === 0} onChange={setDeduct} label="Deduct these ingredients on every sale" />
              <span className="recipe__logic-note">
                <Info size={12} />{' '}
                {savedDeduct
                  ? 'Active: ingredients are reserved when an order is placed, returned if it is cancelled, and used when it is completed.'
                  : 'Not deducted: sales of this product do not change ingredient stock.'}
              </span>
            </div>
          </>
        )}
      </>
    );
  };

  return (
    <aside className="recipe" aria-label="Product recipe configuration">
      <header className="recipe__header">
        <div>
          <span className="recipe__eyebrow">Recipes</span>
          <h2>Product Recipe Configuration</h2>
        </div>
        <Tabs
          items={[
            { value: 'recipe', label: 'Recipe' },
            { value: 'log', label: 'Stock Log' },
          ]}
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
        />
      </header>

      <div className="recipe__body">
        {tab === 'recipe' ? (
          body()
        ) : !logIngredient ? (
          <p className="recipe__hint">Select an ingredient row to see its stock history.</p>
        ) : (
          <div className="recipe-log">
            <strong className="recipe-log__title">
              {logIngredient.name} <span className="code-chip">#{logIngredient.code}</span>
            </strong>
            <ul>
              {[...logIngredient.movements].reverse().map((m) => (
                <li key={m.id}>
                  <div>
                    <strong>{m.type === 'initial' ? 'Initial Stock' : m.type === 'restock' ? 'Restock' : 'Adjustment'}</strong>
                    <span>{[m.reason, m.note].filter(Boolean).join(' · ') || '—'}</span>
                    <em>{formatWhen(m.at)}</em>
                  </div>
                  <div className="recipe-log__nums">
                    <b className={m.delta < 0 ? 'neg' : 'pos'}>
                      {m.delta < 0 ? '−' : '+'}
                      {Math.abs(m.delta)} {logIngredient.unit}
                    </b>
                    <span>
                      Bal. {m.balanceAfter} {logIngredient.unit}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {tab === 'recipe' && product && (
        <footer className="recipe__footer">
          <Button disabled={!dirty} onClick={() => load(productId)}>
            Discard
          </Button>
          <Button variant="primary" disabled={!dirty} onClick={save}>
            Save Recipe Changes
          </Button>
        </footer>
      )}

      <ConfirmDialog
        open={pendingProduct !== null}
        title="Discard unsaved recipe changes?"
        message={`Changes to ${product?.name ?? 'this recipe'} have not been saved.`}
        confirmLabel="Discard & Switch"
        danger
        onCancel={() => setPendingProduct(null)}
        onConfirm={() => {
          if (pendingProduct !== null) load(pendingProduct);
          setPendingProduct(null);
        }}
      />
    </aside>
  );
}
