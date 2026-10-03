export type StockMovementType = 'initial' | 'restock' | 'adjustment' | 'correction' | 'sale';

export interface StockMovement {
  id: string;
  type: StockMovementType;
  /** Signed change applied to stock. */
  delta: number;
  balanceAfter: number;
  reason?: string;
  note?: string;
  at: Date;
}

/** Inventory-owned data for one product (stock quantity itself lives on the product). */
export interface InventoryRecord {
  productId: string;
  unit: string;
  threshold: number;
  lastRestockedAt: Date | null;
  movements: StockMovement[];
}

export type StockStatus = 'in' | 'low' | 'out';

export function stockStatus(stock: number, threshold: number): StockStatus {
  if (stock <= 0) return 'out';
  if (stock <= threshold) return 'low';
  return 'in';
}
