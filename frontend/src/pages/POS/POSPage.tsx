import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import SearchBar from '../../components/ui/SearchBar';
import EmptyState from '../../components/ui/EmptyState';
import LoadingState from '../../components/ui/LoadingState';
import Button from '../../components/ui/Button';
import CategoryBar from '../../components/pos/CategoryBar';
import ProductGrid from '../../components/pos/ProductGrid';
import CartPanel, { type CartTotals } from '../../components/pos/CartPanel';
import ChoiceSelector from '../../components/pos/ChoiceSelector';
import DiscountSelector from '../../components/pos/DiscountSelector';
import CheckoutModal from '../../components/pos/CheckoutModal';
import { cartReducer } from '../../stores/cartStore';
import { useAuth, can } from '../../stores/authStore';
import { ApiError, errorMessage, isUnknownOutcome, newIdempotencyKey } from '../../services/api';
import * as catalogApi from '../../services/productService';
import { createOrder, quote, submissionStatus, type OrderInput } from '../../services/orderService';
import type { CartLine, OrderType, SelectedChoice } from '../../types/order';
import type { Category, ChoiceGroup, Product } from '../../types/product';
import type { DiscountDto, OrderDto, QuoteDto } from '../../types/api';
import { toApiOrderType } from '../../utils/apiMappers';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import IdentificationDialog from '../../components/pos/IdentificationDialog';
import { usePreferenceSettings } from '../../stores/preferenceSettingsStore';
import { useFeatureSettings } from '../../stores/featureSettingsStore';
import { markOwnOrder } from '../../stores/notificationStore';
import { alertGates } from '../../utils/liveAlerts';
import { playSound } from '../../utils/sound';
import '../../components/pos/pos.css';

const ALL = 'all';

/** A checkout whose outcome is unknown (timeout): resolved with the SAME key and payload, never resent
 *  as a new order. Kept in sessionStorage so a page reload cannot lose it (10, 11). */
interface PendingSubmission {
  key: string;
  input: OrderInput;
}
const PENDING_KEY = 'brewsync.pendingOrder';
function loadPending(): PendingSubmission | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingSubmission) : null;
  } catch {
    return null;
  }
}
function savePending(value: PendingSubmission | null) {
  try {
    if (value) sessionStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage unavailable: the pending state lives for this page only */
  }
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function formatClock(date: Date) {
  const day = date.toLocaleDateString(undefined, { weekday: 'short' });
  const rest = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${rest}, ${time}`;
}

interface Menu {
  categories: Category[];
  products: Product[];
  discounts: DiscountDto[];
}

/** POS menu from the API: active + available products, their choice groups and stock. */
async function loadMenu(background = false): Promise<Menu> {
  const { categories, products, choice_groups: groups, discounts, stock: levels, availability = {} } = await catalogApi.getPosMenu(background);
  const groupById = new Map<string, ChoiceGroup>(
    groups
      .filter((g) => g.active !== false)
      .map((g) => [
        g.id,
        {
          id: g.id,
          name: g.name,
          mode: g.selection_type === 'multi' ? 'multiple' : 'single',
          required: g.required,
          minSelect: g.min_select,
          maxSelect: g.max_select,
          options: g.options
            .filter((o) => o.active !== false)
            .map((o) => ({ id: o.id, label: o.name, priceDelta: Number(o.price_delta), isDefault: o.is_default === true })),
        },
      ]),
  );
  const levelById = new Map(levels.filter((l) => l.subject_type === 'product').map((l) => [l.subject_id, l]));
  const activeCategories = categories.filter((c) => c.active);
  const activeCategoryIds = new Set(activeCategories.map((c) => c.id));
  return {
    categories: activeCategories.map((c) => ({ id: c.id, name: c.name })),
    products: products
      .filter((p) => p.active && p.available && activeCategoryIds.has(p.category_id))
      .map((p) => {
        const level = levelById.get(p.id);
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          description: p.description,
          categoryId: p.category_id,
          price: Number(p.price),
          stock: level ? Number(level.available) : 0,
          tracked: p.track_units,
          lowStockThreshold: level ? Number(level.low_stock_threshold) : undefined,
          unavailableReasons: availability[p.id] && !availability[p.id].sellable ? availability[p.id].reasons : [],
          lowIngredients: availability[p.id]?.low_stock ?? [],
          image: p.image_url ?? '',
          choiceGroups: p.choice_group_ids.map((id) => groupById.get(id)).filter((g): g is ChoiceGroup => !!g),
        };
      }),
    discounts: discounts.filter((d) => d.active),
  };
}

function toOrderInput(lines: CartLine[], orderType: OrderType, discountId: string | null, identification?: Record<string, string> | null): OrderInput {
  return {
    order_type: toApiOrderType(orderType),
    lines: lines.map((l) => {
      const selections: Record<string, string[]> = {};
      for (const c of l.choices) (selections[c.groupId] ??= []).push(c.id);
      return { product_id: l.productId, quantity: l.quantity, ...(l.choices.length ? { selections } : {}) };
    }),
    ...(discountId ? { discount: { discount_id: discountId, ...(identification ? { identification } : {}) } } : {}),
  };
}

function discountDescription(d: DiscountDto): string {
  const value = d.type === 'percentage' ? `${Number(d.value)}% off` : `₱${Number(d.value).toFixed(2)} off`;
  return d.requires_identification ? `${value} · requires customer ID` : value;
}

export default function POSPage() {
  const now = useClock();
  const { user } = useAuth();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [category, setCategory] = useState(ALL);
  const [query, setQuery] = useState('');
  const [lines, dispatch] = useReducer(cartReducer, []);
  const [orderType, setOrderType] = useState<OrderType>('dine-in');
  // Settings → Preferences (PREF-01): default order type for a new sale; confirm before removing a line.
  const { settings: prefs, loaded: prefsLoaded } = usePreferenceSettings();
  const { flags } = useFeatureSettings();
  const gates = alertGates(flags, prefs);
  const PREF_TYPE: Record<string, OrderType> = { dineIn: 'dine-in', takeout: 'takeout', delivery: 'delivery' };
  const appliedDefault = useRef(false);
  useEffect(() => {
    if (!prefsLoaded || appliedDefault.current) return;
    appliedDefault.current = true;
    setOrderType(PREF_TYPE[prefs.defaultOrderType] ?? 'dine-in');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsLoaded, prefs.defaultOrderType]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [choiceProduct, setChoiceProduct] = useState<Product | null>(null);
  const [discountId, setDiscountId] = useState<string | null>(null);
  // Customer identification for discounts that require it (Q-DSC-3); cleared with the discount.
  const [identification, setIdentification] = useState<Record<string, string> | null>(null);
  const [identifying, setIdentifying] = useState<DiscountDto | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [pricing, setPricing] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; quote: QuoteDto | null; error: string | null }>({
    status: 'idle',
    quote: null,
    error: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [linesVersion, setLinesVersion] = useState(0);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<OrderDto | null>(null);
  // Same key for retries of the same cart; a new cart gets a new key.
  const orderKey = useRef<string | null>(null);
  const [pending, setPending] = useState<PendingSubmission | null>(() => loadPending());
  const updatePending = (value: PendingSubmission | null) => {
    savePending(value);
    setPending(value);
  };

  const refreshMenu = useCallback(async (background = false) => {
    if (!background) setMenuError(null);
    try {
      setMenu(await loadMenu(background));
      setMenuError(null);
    } catch (err) {
      if (!background) setMenuError(errorMessage(err)); // a failed background refresh keeps the current menu
    }
  }, []);

  useEffect(() => {
    void refreshMenu();
  }, [refreshMenu]);

  // Live Updates (Settings → Features + Preferences): stock/availability refresh in the background
  // every 30 s while the tab is visible. The server still re-checks everything at order time.
  useEffect(() => {
    if (!gates.live) return;
    const id = window.setInterval(() => {
      if (!document.hidden) void refreshMenu(true);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [gates.live, refreshMenu]);

  // Server-authoritative totals: re-quote whenever the cart or discount changes.
  useEffect(() => {
    if (!loadPending()) orderKey.current = null; // an unresolved submission keeps its key
    setOrderError(null);
    if (lines.length === 0) {
      setPricing({ status: 'idle', quote: null, error: null });
      return;
    }
    let cancelled = false;
    setPricing((p) => ({ ...p, status: 'loading', error: null }));
    const id = window.setTimeout(() => {
      quote(toOrderInput(lines, orderType, discountId, identification))
        .then((q) => !cancelled && setPricing({ status: 'ready', quote: q, error: null }))
        .catch((err) => !cancelled && setPricing({ status: 'error', quote: null, error: errorMessage(err) }));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [lines, orderType, discountId, identification, linesVersion]);

  const products = menu?.products ?? [];
  const categories = menu?.categories ?? [];

  const categoryItems = useMemo(
    () => [
      { value: ALL, label: 'All Items', count: products.length },
      ...categories.map((c) => ({ value: c.id, label: c.name, count: products.filter((p) => p.categoryId === c.id).length })),
    ],
    [products, categories],
  );

  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) => (category === ALL || p.categoryId === category) && (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)),
    );
  }, [products, category, query]);

  const discount = menu?.discounts.find((d) => d.id === discountId) ?? null;
  const q = pricing.quote;
  const totals: CartTotals = {
    itemCount: lines.length,
    quantity: lines.reduce((sum, l) => sum + l.quantity, 0),
    subtotal: q ? Number(q.subtotal) : 0,
    discount: q ? Number(q.discount_total) : 0,
    vat: q ? Number(q.tax_amount) : 0,
    total: q ? Number(q.total) : 0,
  };

  const handleSelectProduct = (product: Product) => {
    if (gates.tapSound) playSound('tap');
    setSelectedProductId(product.id);
    if (product.choiceGroups.length > 0) setChoiceProduct(product);
    else dispatch({ type: 'add', product, choices: [] });
  };

  const handleConfirmChoices = (product: Product, choices: SelectedChoice[]) => {
    dispatch({ type: 'add', product, choices });
    setChoiceProduct(null);
  };

  const resetOrder = () => {
    dispatch({ type: 'clear' });
    setDiscountId(null);
    setIdentification(null);
    setSelectedProductId(null);
  };

  const cartAvailability = pricing.quote?.availability;
  const cartBlocked = !!cartAvailability && !cartAvailability.ok;
  const cartReasons = cartAvailability && !cartAvailability.ok
    ? [...cartAvailability.shortfalls.map((s) => s.message), ...cartAvailability.issues.map((i) => i.message)]
    : [];

  const finishPlaced = (order: OrderDto) => {
    markOwnOrder(order.id);
    orderKey.current = null;
    updatePending(null);
    resetOrder();
    setPlaced(order);
    void refreshMenu(); // stock is now reserved
  };

  const submit = async (submission: PendingSubmission) => {
    setSubmitting(true);
    setOrderError(null);
    try {
      finishPlaced(await createOrder(submission.input, submission.key));
    } catch (err) {
      if (isUnknownOutcome(err)) {
        // The order may exist. Keep the key + payload; the next attempt replays or resolves it.
        updatePending(submission);
        setOrderError('No answer from the server — the order may or may not have been created. Press "Check order" to find out; it will never be charged twice.');
      } else {
        updatePending(null);
        orderKey.current = null;
        if (err instanceof ApiError && ['INSUFFICIENT_STOCK', 'RECIPE_INVALID', 'CART_STALE'].includes(err.code)) {
          void refreshMenu();
          setLinesVersion((v) => v + 1); // re-quote so the cart shows current totals/availability
        }
        setOrderError(errorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  /** Resolve an unknown outcome: the lookup waits for any in-flight request, then answers. */
  const resolvePending = async () => {
    if (!pending || submitting) return;
    setSubmitting(true);
    setOrderError(null);
    try {
      const status = await submissionStatus(pending.key);
      if (status.status === 'created' && status.order) {
        finishPlaced(status.order);
        return;
      }
      setSubmitting(false);
      await submit(pending); // not created: send the SAME request again (same key)
    } catch (err) {
      setOrderError(`${errorMessage(err)} The earlier order is still unresolved.`);
    } finally {
      setSubmitting(false);
    }
  };

  const placeOrder = async () => {
    if (pending) return void resolvePending();
    if (lines.length === 0 || submitting || cartBlocked || pricing.status !== 'ready' || !pricing.quote) return;
    orderKey.current ??= newIdempotencyKey();
    const input = { ...toOrderInput(lines, orderType, discountId, identification), expected_total: pricing.quote.total };
    await submit({ key: orderKey.current, input });
  };

  let productArea;
  if (!menu && menuError)
    productArea = (
      <EmptyState title="Could not load the menu" description={menuError} action={<Button onClick={() => void refreshMenu()}>Try again</Button>} />
    );
  else if (!menu) productArea = <LoadingState label="Loading menu…" />;
  else if (products.length === 0)
    productArea = (
      <EmptyState
        title="No products on the menu yet"
        description={can(user, 'products.create') ? 'Add products in Admin → Products.' : 'Ask an Admin to add products.'}
      />
    );
  else productArea = <ProductGrid products={visibleProducts} categories={categories} selectedId={selectedProductId} onSelect={handleSelectProduct} />;

  return (
    <div className="pos">
      <section className="pos__workspace">
        <div className="pos__toolbar">
          <SearchBar
            className="pos__search"
            placeholder="Search products by name or code…"
            shortcut="⌘K"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="pos__status">
            <span className="sync-pill">
              <span className="status-dot" /> Online
            </span>
            <button type="button" className="icon-btn" aria-label="Refresh" title="Refresh menu and stock" onClick={() => void refreshMenu()}>
              <RefreshCw size={15} />
            </button>
            <span className="pos__clock">
              <Clock size={15} /> {formatClock(now)}
            </span>
          </div>
        </div>

        <CategoryBar items={categoryItems} value={category} onChange={setCategory} />

        <div className="pos__products">{productArea}</div>
      </section>

      <CartPanel
        orderNumber="New"
        orderType={orderType}
        onOrderTypeChange={setOrderType}
        showOrderType={prefs.showOrderTypeAtCheckout}
        discountsEnabled={flags.discounts}
        lines={lines}
        totals={totals}
        discountLabel={discount?.name ?? null}
        pricing={pricing.status}
        submitting={submitting}
        error={orderError ?? pricing.error ?? (cartReasons.length ? `Cannot place this order: ${cartReasons.join('; ')}` : null)}
        blocked={cartBlocked && !pending}
        chargeLabel={pending ? 'Check order' : undefined}
        onIncrement={(key) => dispatch({ type: 'increment', key })}
        onDecrement={(key) => dispatch({ type: 'decrement', key })}
        onRemove={(key) => (prefs.confirmRemoveCartItem ? setRemoving(key) : dispatch({ type: 'remove', key }))}
        onClear={resetOrder}
        onOpenDiscount={() => setDiscountOpen(true)}
        onClearDiscount={() => {
          setDiscountId(null);
          setIdentification(null);
        }}
        onCharge={() => void placeOrder()}
      />

      <ChoiceSelector product={choiceProduct} onClose={() => setChoiceProduct(null)} onConfirm={handleConfirmChoices} />

      <DiscountSelector
        open={discountOpen}
        options={(menu?.discounts ?? [])
          .filter((d) => d.active !== false)
          .map((d) => ({ id: d.id, label: d.name, description: discountDescription(d) }))}
        selectedId={discountId}
        onSelect={(id) => {
          setDiscountOpen(false);
          const chosen = menu?.discounts.find((d) => d.id === id) ?? null;
          if (chosen?.requires_identification) {
            setIdentifying(chosen);
            return;
          }
          setDiscountId(id);
          setIdentification(null);
        }}
        onClose={() => setDiscountOpen(false)}
      />

      <IdentificationDialog
        discount={identifying}
        onCancel={() => setIdentifying(null)}
        onConfirm={(d, details) => {
          setDiscountId(d.id);
          setIdentification(details);
          setIdentifying(null);
        }}
      />

      <CheckoutModal order={placed} onClose={() => setPlaced(null)} onPaid={setPlaced} />

      <ConfirmDialog
        open={removing !== null}
        title="Remove this item?"
        message={`${lines.find((l) => l.key === removing)?.name ?? 'The item'} is removed from the current order.`}
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          if (removing) dispatch({ type: 'remove', key: removing });
          setRemoving(null);
        }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
