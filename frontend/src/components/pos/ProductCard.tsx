import { useState } from 'react';
import { Coffee, Plus } from 'lucide-react';
import Badge from '../ui/Badge';
import type { Product } from '../../types/product';
import { formatPeso } from '../../utils/currency';

interface ProductCardProps {
  product: Product;
  categoryName: string;
  selected: boolean;
  onSelect: (product: Product) => void;
}

function StockBadge({ stock, threshold }: { stock: number; threshold: number }) {
  if (stock <= 0) return <Badge tone="danger">Out of Stock</Badge>;
  if (stock <= threshold) return <Badge tone="warning">Low Stock ({stock} left)</Badge>;
  return <Badge tone="success">In Stock ({stock})</Badge>;
}

export default function ProductCard({ product, categoryName, selected, onSelect }: ProductCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const tracked = product.tracked !== false;
  const reasons = product.unavailableReasons ?? [];
  // A product with choices may still be sellable in another configuration (e.g. Oat Milk when Fresh
  // Milk is out), so it opens the selector, which checks the exact configuration with the server.
  const soldOut = (tracked && product.stock <= 0) || (reasons.length > 0 && product.choiceGroups.length === 0);
  const why = reasons.length ? `Unavailable — ${reasons.join('; ')}` : undefined;

  return (
    <article
      className={`product-card ${selected ? 'product-card--selected' : ''} ${soldOut ? 'product-card--disabled' : ''}`}
      onClick={() => !soldOut && onSelect(product)}
      title={why}
      aria-disabled={soldOut || undefined}
    >
      <div className="product-card__media">
        {imageFailed || !product.image ? (
          <div className="product-card__fallback">
            <Coffee size={32} />
          </div>
        ) : (
          <img src={product.image} alt={product.name} loading="lazy" onError={() => setImageFailed(true)} />
        )}
        <span className="product-card__code">#{product.code}</span>
        {reasons.length > 0 ? (
          <span className="product-card__stock">
            <Badge tone="danger">Unavailable</Badge>
          </span>
        ) : tracked ? (
          <span className="product-card__stock">
            <StockBadge stock={product.stock} threshold={product.lowStockThreshold ?? 0} />
          </span>
        ) : (product.lowIngredients ?? []).length > 0 ? (
          <span className="product-card__stock" title={`Low stock: ${product.lowIngredients!.join(', ')}`}>
            <Badge tone="warning">Low stock</Badge>
          </span>
        ) : null}
      </div>

      <div className="product-card__body">
        <span className="product-card__category">{categoryName}</span>
        <h3 className="product-card__name">{product.name}</h3>
        {reasons.length > 0 ? (
          <p className="product-card__reason" role="note">
            {reasons[0]}
            {reasons.length > 1 ? ` (+${reasons.length - 1} more)` : ''}
          </p>
        ) : (
          <p className="product-card__description">{product.description}</p>
        )}
      </div>

      <div className="product-card__footer">
        <div>
          <span className="product-card__price-label">Price</span>
          <span className="product-card__price">{formatPeso(product.price)}</span>
        </div>
        <button
          type="button"
          className="product-card__add"
          aria-label={`Add ${product.name}`}
          disabled={soldOut}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(product);
          }}
        >
          <Plus size={18} />
        </button>
      </div>
    </article>
  );
}
