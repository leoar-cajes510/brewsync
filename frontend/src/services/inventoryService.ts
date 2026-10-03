import { api, newIdempotencyKey } from './api';
import type { IngredientDto, IngredientUnitDto, RecipeDto, StockLevelDto, StockMovementDto } from '../types/api';

export const listStock = () => api.get<StockLevelDto[]>('/inventory');

export const restockProduct = (productId: string, quantity: number, note?: string) =>
  api.post<StockLevelDto>(`/inventory/${productId}/restock`, { quantity: String(quantity), note }, newIdempotencyKey());

export type AdjustReason = 'damaged' | 'lost' | 'other';

export const adjustProduct = (productId: string, delta: number, reason: AdjustReason, note?: string) =>
  api.post<StockLevelDto>(`/inventory/${productId}/adjust`, { delta: String(delta), reason, note }, newIdempotencyKey());

/** Count correction: the server requires a documented reason. */
export const correctProduct = (productId: string, delta: number, reason: string, note?: string) =>
  api.post<StockLevelDto>(`/inventory/${productId}/correct`, { delta: String(delta), reason, note }, newIdempotencyKey());

export const productMovements = (productId: string) => api.get<StockMovementDto[]>(`/inventory/${productId}/movements`);

export const setProductThreshold = (productId: string, threshold: number) =>
  api.patch<StockLevelDto>(`/inventory/${productId}`, { low_stock_threshold: String(threshold) });

/* ---------------------------- Ingredients --------------------------- */

export const listIngredients = () => api.get<IngredientDto[]>('/ingredients');

export interface NewIngredient {
  code: string;
  name: string;
  category: string;
  unit: IngredientUnitDto;
  unit_cost: string;
  notes?: string;
  initial_stock: string;
  low_stock_threshold: string;
}

export const createIngredient = (ingredient: NewIngredient) => api.post<{ id: string }>('/ingredients', ingredient);

export type IngredientPatch = Partial<Pick<IngredientDto, 'name' | 'category' | 'unit_cost' | 'notes' | 'active'>>;
export const updateIngredient = (id: string, patch: IngredientPatch) => api.patch<IngredientDto>(`/ingredients/${id}`, patch);

export const ingredientMovements = (id: string) => api.get<StockMovementDto[]>(`/ingredients/${id}/movements`);

export const setIngredientThreshold = (id: string, threshold: string) =>
  api.patch<StockLevelDto>(`/ingredients/${id}/threshold`, { low_stock_threshold: threshold });

/** Stock action on an ingredient: restock (quantity), adjust (delta + reason), correct (delta + reason), waste (quantity). */
export const moveIngredient = (id: string, action: 'restock' | 'adjust' | 'correct' | 'waste', body: Record<string, string | undefined>) =>
  api.post<StockLevelDto>(`/ingredients/${id}/${action}`, body, newIdempotencyKey());

export const getRecipe = (productId: string) => api.get<RecipeDto>(`/products/${productId}/recipe`);
export const saveRecipe = (productId: string, lines: { ingredient_id: string; quantity: string }[], trackIngredients?: boolean) =>
  api.put<RecipeDto>(`/products/${productId}/recipe`, { lines, track_ingredients: trackIngredients });
