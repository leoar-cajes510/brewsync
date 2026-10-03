import { Pencil } from 'lucide-react';
import Badge from '../../ui/Badge';
import Button from '../../ui/Button';
import Drawer from '../../ui/Drawer';
import { ProductThumb, StockLevel, formatUpdated, productStatus } from './ProductTable';
import type { CatalogProduct } from '../../../types/product';
import { formatPeso } from '../../../utils/currency';
import { getThreshold } from '../../../stores/catalogStore';

const statusLabel = { active: 'Active', low: 'Low Stock', out: 'Out of Stock', inactive: 'Inactive' } as const;
const statusTone = { active: 'success', low: 'warning', out: 'danger', inactive: 'neutral' } as const;

interface ProductDetailsDrawerProps {
  product: CatalogProduct | null;
  onClose: () => void;
  onEdit: (p: CatalogProduct) => void;
}

export default function ProductDetailsDrawer({ product, onClose, onEdit }: ProductDetailsDrawerProps) {
  const status = product ? productStatus(product) : 'active';
  return (
    <Drawer
      open={product !== null}
      onClose={onClose}
      title="Product Details"
      footer={
        product && (
          <Button variant="primary" icon={<Pencil size={15} />} onClick={() => onEdit(product)}>
            Edit Product
          </Button>
        )
      }
    >
      {product && (
        <div className="product-details">
          <ProductThumb product={product} size="lg" />
          <div className="product-details__title">
            <h3>{product.name}</h3>
            <span className="code-chip">#{product.code}</span>
          </div>
          <p className="text-muted">{product.description || 'No description'}</p>
          <div className="product-details__badges">
            <Badge tone={product.available ? 'success' : 'neutral'} dot>
              {product.available ? 'Available' : 'Unavailable'}
            </Badge>
            <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>
          </div>
          <dl className="product-details__list">
            <div>
              <dt>Category</dt>
              <dd>{product.category}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>{formatPeso(product.price)}</dd>
            </div>
            <div>
              <dt>Stock</dt>
              <dd>
                <StockLevel stock={product.stock} threshold={getThreshold(product.id)} tracked={product.trackUnits} />
              </dd>
            </div>
            <div>
              <dt>Last Updated</dt>
              <dd>{formatUpdated(product.updatedAt)}</dd>
            </div>
          </dl>
          <p className="product-details__note">Stock adjustments, choices, and recipes are managed in their own Admin sections.</p>
        </div>
      )}
    </Drawer>
  );
}
