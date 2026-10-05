import { useEffect, useSyncExternalStore } from 'react';
import type { CatalogProduct, CatalogProductDraft } from '../types/product';
import type { InventoryRecord, StockMovement, StockMovementType } from '../types/inventory';
import type { CategoryDto, ProductDto, StockLevelDto, StockMovementDto } from '../types/api';
import { errorMessage } from '../services/api';
import * as products from '../services/productService';
import * as stock from '../services/inventoryService';

// Catalog shared by Admin → Products and Admin → Inventory, loaded from the API
// (GET /categories, /products, /inventory). A fresh business has no products until the
// owner adds them — nothing is seeded. The server is authoritative for stock and prices.

/** Display fallback only (e.g. an untracked product); real thresholds come from stock levels. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 0;
export const DEFAULT_STOCK_UNIT = 'units';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface CatalogState {
  status: LoadStatus;
  error: string | null;
  categories: CategoryDto[];
  products: CatalogProduct[];
  inventory: Record<string, InventoryRecord>;
}

let state: CatalogState = { status: 'idle', error: null, categories: [], products: [], inventory: {} };
const listeners = new Set<() => void>();
/** Movement logs fetched from GET /inventory/{id}/movements, newest first (server-authoritative). */
const serverMovements: Record<string, StockMovement[]> = {};
const MOVEMENT_TYPES: StockMovementType[] = ['initial', 'restock', 'adjustment', 'correction', 'sale'];

function set(patch: Partial<CatalogState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCatalog(): CatalogState {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    // Refresh on every page visit so Products, Inventory and the POS see current server data.
    void loadCatalog();
  }, []);
  return snapshot;
}

const num = (v: string | undefined) => (v === undefined ? 0 : Number(v));

function toCatalog(p: ProductDto, categories: CategoryDto[], level: StockLevelDto | undefined): CatalogProduct {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    category: categories.find((c) => c.id === p.category_id)?.name ?? '',
    categoryId: p.category_id,
    price: Number(p.price),
    taxClass: p.tax_class,
    trackUnits: p.track_units,
    stock: num(level?.on_hand),
    sellable: num(level?.available),
    description: p.description,
    image: p.image_url,
    available: p.available,
    choiceGroupIds: p.choice_group_ids,
    active: p.active,
    updatedAt: p.updated_at ? new Date(p.updated_at) : new Date(),
  };
}

function toRecord(productId: string, level: StockLevelDto): InventoryRecord {
  return {
    productId,
    unit: DEFAULT_STOCK_UNIT,
    threshold: num(level.low_stock_threshold),
    lastRestockedAt: serverMovements[productId]?.find((m) => m.type === 'restock')?.at ?? null,
    movements: serverMovements[productId] ?? [],
  };
}

let inflight: Promise<void> | null = null;

export function loadCatalog(): Promise<void> {
  if (inflight) return inflight;
  set({ status: state.status === 'ready' ? 'ready' : 'loading', error: null });
  inflight = (async () => {
    try {
      const [categories, list, levels] = await Promise.all([products.listCategories(), products.listProducts(), stock.listStock()]);
      const byId = new Map(levels.filter((l) => l.subject_type === 'product').map((l) => [l.subject_id, l]));
      const inventory: Record<string, InventoryRecord> = {};
      for (const [id, level] of byId) inventory[id] = toRecord(id, level);
      set({ status: 'ready', categories, products: list.map((p) => toCatalog(p, categories, byId.get(p.id))), inventory });
    } catch (error) {
      set({ status: 'error', error: errorMessage(error) });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Categories are created on demand from the product form (a new name creates a category). */
async function ensureCategory(name: string, codePrefix?: string): Promise<string> {
  // Exact name first; a case-insensitive match only when there is no exact one (CAT-04/PRD-04).
  const wanted = name.trim();
  const existing =
    state.categories.find((c) => c.name === wanted) ?? state.categories.find((c) => c.name.toLowerCase() === wanted.toLowerCase());
  if (existing) return existing.id;
  if (!codePrefix) throw new Error('Enter a code prefix for the new category.');
  const created = await products.createCategory(name.trim(), codePrefix);
  set({ categories: [...state.categories, created] });
  return created.id;
}

/* ---------------------------- Products ---------------------------- */

/** Creates the product; resolves to the server-generated code. */
export async function addProduct(draft: CatalogProductDraft, idempotencyKey?: string): Promise<{ id: string; code: string }> {
  if (!draft.taxClass) throw new Error('Choose whether the product is taxable.');
  const categoryId = await ensureCategory(draft.category, draft.categoryPrefix);
  const created = await products.createProduct({
    name: draft.name,
    description: draft.description,
    category_id: categoryId,
    price: draft.price.toFixed(2),
    tax_class: draft.taxClass,
    available: draft.available,
    track_units: draft.trackUnits,
    choice_group_ids: draft.choiceGroupIds,
    ...(draft.trackUnits ? { initial_stock: draft.stock, low_stock_threshold: draft.lowStockThreshold } : {}),
  }, idempotencyKey);
  await loadCatalog();
  return { id: created.id, code: created.code };
}

/** Saves an image change for an existing product: a Blob uploads (replacing any previous image), `null` removes it. */
export async function saveProductImage(id: string, image: Blob | null): Promise<void> {
  if (image) await products.uploadProductImage(id, image);
  else await products.deleteProductImage(id);
  await loadCatalog();
}

/** Edits catalog fields only; stock is owned by Inventory and never changed here. The code is never
 *  sent: it is immutable, and moving a product to another category keeps it. */
export async function updateProduct(id: string, draft: Omit<CatalogProductDraft, 'stock'>): Promise<void> {
  const current = state.products.find((p) => p.id === id);
  const categoryId = await ensureCategory(draft.category, draft.categoryPrefix);
  await products.updateProduct(id, {
    name: draft.name,
    description: draft.description,
    price: draft.price.toFixed(2),
    available: draft.available,
    choice_group_ids: draft.choiceGroupIds,
    ...(draft.taxClass ? { tax_class: draft.taxClass } : {}),
    ...(current?.categoryId !== categoryId ? { category_id: categoryId } : {}),
  });
  await loadCatalog();
}

/** The copy gets a fresh generated code from its category (e.g. COF-007 → COF-008), never "-COPY". */
export async function duplicateProduct(source: CatalogProduct): Promise<CatalogProduct | undefined> {
  const { code } = await addProduct({
    ...source,
    name: `${source.name} (Copy)`,
    stock: 0,
    lowStockThreshold: state.inventory[source.id]?.threshold,
  });
  return state.products.find((p) => p.code === code);
}

export async function toggleProductActive(id: string): Promise<void> {
  const product = state.products.find((p) => p.id === id);
  if (!product) return;
  await products.updateProduct(id, { active: !product.active });
  await loadCatalog();
}

/** DELETE /products/{id}: allowed only for a product that was never sold, reserved or moved
 *  (Q-DEL-1); otherwise the server answers 409 and the product must be deactivated instead. */
export async function removeProduct(id: string): Promise<void> {
  await products.deleteProduct(id);
  await loadCatalog();
}

/* ---------------------------- Inventory --------------------------- */

function movementFromDto(m: StockMovementDto): StockMovement {
  const known = MOVEMENT_TYPES.includes(m.type as StockMovementType);
  return {
    id: m.id,
    type: known ? (m.type as StockMovementType) : 'adjustment',
    delta: Number(m.delta_on_hand),
    balanceAfter: Number(m.on_hand_after),
    reason: m.reason ?? (known ? undefined : m.type.replace(/_/g, ' ')),
    note: m.note ?? undefined,
    at: new Date(m.created_at),
  };
}

/** Loads a product's movement log from the server and refreshes its inventory record. */
export async function loadMovements(productId: string): Promise<void> {
  const list = await stock.productMovements(productId);
  serverMovements[productId] = list.map(movementFromDto).sort((a, b) => b.at.getTime() - a.at.getTime());
  const record = state.inventory[productId];
  if (record) set({ inventory: { ...state.inventory, [productId]: { ...record, movements: serverMovements[productId], lastRestockedAt: serverMovements[productId].find((m) => m.type === 'restock')?.at ?? null } } });
}

export async function restock(productId: string, quantity: number, _unit: string, note?: string): Promise<void> {
  await stock.restockProduct(productId, quantity, note);
  await loadCatalog();
  await loadMovements(productId);
}

export type AdjustmentReason = 'Count Correction' | 'Damaged' | 'Lost' | 'Other';

export async function adjustStock(productId: string, delta: number, reason: AdjustmentReason, note?: string): Promise<void> {
  await (reason === 'Count Correction'
      ? stock.correctProduct(productId, delta, 'Count correction', note)
      : stock.adjustProduct(productId, delta, reason.toLowerCase() as stock.AdjustReason, note));
  await loadCatalog();
  await loadMovements(productId);
}

/** PATCH /inventory/{id}: change the low-stock threshold (stock quantities are untouched). */
export async function setThreshold(productId: string, threshold: number): Promise<void> {
  await stock.setProductThreshold(productId, threshold);
  await loadCatalog();
}

/** Low-stock threshold for a product (from its server stock level). */
export function getThreshold(productId: string): number {
  return state.inventory[productId]?.threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
}
