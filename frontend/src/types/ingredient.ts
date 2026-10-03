// Admin → Ingredients: raw materials and product recipes (persisted via /ingredients and
// /products/{id}/recipe; stock changes are server-side movements).
import type { StockStatus } from './inventory';

export type IngredientMovementType = 'initial' | 'restock' | 'adjustment';

export interface IngredientMovement {
  id: string;
  type: IngredientMovementType;
  /** Signed change applied to stock. */
  delta: number;
  balanceAfter: number;
  reason?: string;
  note?: string;
  at: Date;
}

export interface Ingredient {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  stock: number;
  /** Cost per one unit, in pesos. */
  cost: number;
  threshold: number;
  notes: string;
  /** false when deactivated (ingredients are never deleted). */
  active?: boolean;
  /** Stock status as computed by the server (available vs threshold). */
  status?: StockStatus;
  updatedAt: Date;
  movements: IngredientMovement[];
}

export type IngredientDraft = Pick<Ingredient, 'name' | 'category' | 'unit' | 'stock' | 'cost' | 'threshold' | 'notes'>;

/** One line of a product recipe: how much of an ingredient one serving uses. */
export interface RecipeLine {
  id: string;
  ingredientId: string;
  quantity: number;
}

/** Recipes keyed by product id (products come from Admin → Products). */
export type RecipeBook = Record<string, RecipeLine[]>;

export const INGREDIENT_UNITS = ['g', 'kg', 'ml', 'L', 'pcs'];

const unitCostFormatter = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** Per-unit costs can be fractions of a centavo (e.g. ₱0.095 / ml), so keep up to 4 decimals. */
export const formatUnitCost = (n: number) => unitCostFormatter.format(n);

/** Trims float noise from stock math (e.g. 0.1 + 0.2). */
export const roundQty = (n: number) => Math.round(n * 1000) / 1000;
