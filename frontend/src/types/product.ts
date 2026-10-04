export interface Category {
  id: string;
  name: string;
}

export interface ChoiceOption {
  id: string;
  label: string;
  priceDelta: number;
  /** Preselected by the Admin (Choices → option "Default"). */
  isDefault?: boolean;
}

export interface ChoiceGroup {
  id: string;
  name: string;
  /** single = pick exactly one (radio); multiple = pick any (checkbox) */
  mode: 'single' | 'multiple';
  required: boolean;
  /** Multi-select bounds (server-validated, R2.3). */
  minSelect?: number;
  maxSelect?: number;
  options: ChoiceOption[];
}

export interface Product {
  id: string;
  code: string;
  name: string;
  description: string;
  categoryId: string;
  price: number;
  /** Units available to sell (server: on hand − reserved). */
  stock: number;
  /** false = stock not tracked for this product (never sold out by stock). */
  tracked?: boolean;
  /** Low-stock threshold from the product's stock level. */
  lowStockThreshold?: number;
  image: string;
  choiceGroups: ChoiceGroup[];
}

/** A product as managed in Admin → Products (what the business sells). */
export interface CatalogProduct {
  id: string;
  code: string;
  name: string;
  /** Category name (display); the server id is `categoryId`. */
  category: string;
  categoryId: string;
  price: number;
  /** Server-configured taxability; no default is assumed (Q-TAX). */
  taxClass: 'taxable' | 'non_taxable' | '';
  /** Unit stock tracking; untracked products have no stock level. */
  trackUnits: boolean;
  /** On-hand units (server). Set once at creation; later changes belong to Admin → Inventory. */
  stock: number;
  /** Units available to sell (on hand − reserved by open orders). */
  sellable: number;
  /** Low-stock threshold for a new tracked product (creation only). */
  lowStockThreshold?: number;
  description: string;
  /** Public image URL (Supabase Storage, Q-ARCH-2) or null for the placeholder. */
  image: string | null;
  /** Shown on the POS menu (Available) or hidden (Unavailable). */
  available: boolean;
  /** Linked choice groups (Admin → Choices), in POS order. */
  choiceGroupIds: string[];
  /** Deactivated products are kept but excluded from selling. */
  active: boolean;
  updatedAt: Date;
}

/** `code` is ignored when saving (server-generated on create, immutable after). `categoryPrefix` is
 *  needed only when `category` names a new category. */
export type CatalogProductDraft = Omit<CatalogProduct, 'id' | 'updatedAt' | 'categoryId' | 'sellable'> & {
  categoryPrefix?: string;
  /** Image change saved after the product: a new optimized image, `null` to remove, omitted = unchanged. */
  imageUpload?: Blob | null;
};
