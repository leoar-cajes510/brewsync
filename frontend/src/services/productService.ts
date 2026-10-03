import { api } from './api';
import type { CategoryDto, ChoiceGroupDto, DiscountDto, ProductDto, StockLevelDto, TaxClass } from '../types/api';

export const listCategories = () => api.get<CategoryDto[]>('/categories');
export const createCategory = (name: string, codePrefix: string) =>
  api.post<CategoryDto>('/categories', { name, code_prefix: codePrefix });

/** Category code prefix: 2–5 letters/digits, starting with a letter (server re-validates). */
export const CODE_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{1,4}$/;

export const listProducts = () => api.get<ProductDto[]>('/products');

/** No `code`: the server generates it from the category (PREFIX-NNN). */
export interface NewProduct {
  name: string;
  description: string;
  category_id: string;
  price: string;
  tax_class: TaxClass;
  available: boolean;
  track_units: boolean;
  initial_stock?: number;
  low_stock_threshold?: number;
  choice_group_ids?: string[];
}

export const createProduct = (product: NewProduct) => api.post<ProductDto>('/products', product);

export type ProductPatch = Partial<
  Pick<ProductDto, 'name' | 'description' | 'category_id' | 'price' | 'tax_class' | 'available' | 'active' | 'choice_group_ids'>
>;

export const updateProduct = (id: string, patch: ProductPatch) => api.patch<ProductDto>(`/products/${id}`, patch);
/** Hard delete only if never sold, reserved or moved (Q-DEL-1); otherwise 409 → deactivate instead. */
export const deleteProduct = (id: string) => api.delete<{ id: string; deleted: boolean }>(`/products/${id}`);

export const listChoiceGroups = () => api.get<ChoiceGroupDto[]>('/choice-groups');
export const listDiscounts = () => api.get<DiscountDto[]>('/discounts');

/** POS start-up data in one request (same content as the five catalog/inventory lists). */
export interface PosMenuDto {
  categories: CategoryDto[];
  products: ProductDto[];
  choice_groups: ChoiceGroupDto[];
  discounts: DiscountDto[];
  stock: StockLevelDto[];
}
export const getPosMenu = () => api.get<PosMenuDto>('/pos/menu');

export const updateCategory = (id: string, patch: Partial<Pick<CategoryDto, 'name' | 'sort_order' | 'active'>>) =>
  api.patch<CategoryDto>(`/categories/${id}`, patch);

export interface ChoiceOptionInput {
  /** Omit for a new option. Existing options left out of an update are deactivated by the server. */
  id?: string;
  name: string;
  price_delta: string;
  is_default: boolean;
  active?: boolean;
}

export interface ChoiceGroupInput {
  name: string;
  display_name: string;
  description: string;
  selection_type: 'single' | 'multi';
  required: boolean;
  min_select: number;
  max_select: number;
  options: ChoiceOptionInput[];
}

export const createChoiceGroup = (group: ChoiceGroupInput & { code: string }) => api.post<ChoiceGroupDto>('/choice-groups', group);
export const updateChoiceGroup = (id: string, patch: Partial<ChoiceGroupInput> & { active?: boolean }) =>
  api.patch<ChoiceGroupDto>(`/choice-groups/${id}`, patch);
