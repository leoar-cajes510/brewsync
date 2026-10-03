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
  const soldOut = tracked && product.stock <= 0;

  return (
    <article
      className={`product-card ${selected ? 'product-card--selected' : ''} ${soldOut ? 'product-card--disabled' : ''}`}
      onClick={() => !soldOut && onSelect(product)}
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
        {tracked && (
          <span className="product-card__stock">
            <StockBadge stock={product.stock} threshold={product.lowStockThreshold ?? 0} />
          </span>
        )}
      </div>

      <div className="product-card__body">
        <span className="product-card__category">{categoryName}</span>
        <h3 className="product-card__name">{product.name}</h3>
        <p className="product-card__description">{product.description}</p>
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
