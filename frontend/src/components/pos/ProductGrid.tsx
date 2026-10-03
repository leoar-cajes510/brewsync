import { SearchX } from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import ProductCard from './ProductCard';
import type { Category, Product } from '../../types/product';

interface ProductGridProps {
  products: Product[];
  categories: Category[];
  selectedId: string | null;
  onSelect: (product: Product) => void;
}

export default function ProductGrid({ products, categories, selectedId, onSelect }: ProductGridProps) {
  if (products.length === 0) {
    return <EmptyState icon={<SearchX size={22} />} title="No products found" description="Try another category or search term." />;
  }

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '';

  return (
    <div className="product-grid">
      {products.map((p) => (
        <ProductCard
          key={p.id}
          product={p}
          categoryName={categoryName(p.categoryId)}
          selected={p.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
