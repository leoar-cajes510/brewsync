import type { CartLine, SelectedChoice } from '../types/order';
import type { Product } from '../types/product';

// POS cart being built before submission (client-side by design; POST /orders creates the real order).

export type CartAction =
  | { type: 'add'; product: Product; choices: SelectedChoice[] }
  | { type: 'increment'; key: string }
  | { type: 'decrement'; key: string }
  | { type: 'remove'; key: string }
  | { type: 'clear' };

export function lineKey(productId: string, choices: SelectedChoice[]): string {
  return [productId, ...choices.map((c) => c.id).sort()].join('|');
}

export function cartReducer(lines: CartLine[], action: CartAction): CartLine[] {
  switch (action.type) {
    case 'add': {
      const key = lineKey(action.product.id, action.choices);
      const existing = lines.find((l) => l.key === key);
      if (existing) {
        return lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      const unitPrice = action.product.price + action.choices.reduce((sum, c) => sum + c.priceDelta, 0);
      return [
        ...lines,
        { key, productId: action.product.id, name: action.product.name, unitPrice, quantity: 1, choices: action.choices },
      ];
    }
    case 'increment':
      return lines.map((l) => (l.key === action.key ? { ...l, quantity: l.quantity + 1 } : l));
    case 'decrement':
      return lines
        .map((l) => (l.key === action.key ? { ...l, quantity: l.quantity - 1 } : l))
        .filter((l) => l.quantity > 0);
    case 'remove':
      return lines.filter((l) => l.key !== action.key);
    case 'clear':
      return [];
  }
}
