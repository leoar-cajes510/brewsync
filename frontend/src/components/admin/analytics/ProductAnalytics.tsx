import { useState } from 'react';
import { PackageSearch } from 'lucide-react';
import EmptyState from '../../ui/EmptyState';
import Select from '../../ui/Select';
import Table, { type TableColumn } from '../../ui/Table';
import Tabs from '../../ui/Tabs';
import { formatPeso } from '../../../utils/currency';
import type { ProductStat } from './analyticsData';

type SortKey = 'revenue' | 'units' | 'margin';
type View = 'top' | 'slow' | 'category';

const initials = (name: string) =>
  name
    .replace(/^Sample\s+/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

// Best sellers / slow movers / category contribution for the selected period.
export default function ProductAnalytics({ products }: { products: ProductStat[] }) {
  const [sort, setSort] = useState<SortKey>('revenue');
  const [view, setView] = useState<View>('top');

  const maxUnits = Math.max(1, ...products.map((p) => p.units));
  const sorted = [...products].sort((a, b) => b[sort] - a[sort]);
  const rows = view === 'top' ? sorted.slice(0, 5) : [...products].sort((a, b) => a.units - b.units).slice(0, 5);

  const categories = Object.values(
    products.reduce<Record<string, { category: string; units: number; revenue: number; share: number }>>((acc, p) => {
      const c = (acc[p.category] ??= { category: p.category, units: 0, revenue: 0, share: 0 });
      c.units += p.units;
      c.revenue += p.revenue;
      c.share += p.share;
      return acc;
    }, {}),
  ).sort((a, b) => b.revenue - a.revenue);

  const columns: TableColumn<ProductStat>[] = [
    {
      key: 'product',
      header: 'Product & Code',
      width: '30%',
      render: (p) => (
        <div className="an-prod">
          <span className="an-prod__avatar">{initials(p.name)}</span>
          <div>
            <strong>{p.name}</strong>
            <span>{p.code}</span>
          </div>
        </div>
      ),
    },
    { key: 'category', header: 'Category', width: '14%', render: (p) => <span className="an-tag">{p.category}</span> },
    {
      key: 'units',
      header: 'Units Sold',
      width: '15%',
      render: (p) => (
        <div className="an-units">
          <strong>{p.units}</strong>
          <span className="an-units__track">
            <span style={{ width: `${(p.units / maxUnits) * 100}%` }} />
          </span>
        </div>
      ),
    },
    { key: 'avg', header: 'Avg Price', align: 'right', width: '12%', render: (p) => <span className="an-muted">{formatPeso(p.avgPrice)}</span> },
    { key: 'revenue', header: 'Total Revenue', align: 'right', width: '15%', render: (p) => <strong className="an-num">{formatPeso(p.revenue)}</strong> },
    {
      key: 'margin',
      header: 'Est. Margin',
      align: 'right',
      width: '14%',
      render: (p) => <span className={`an-margin ${p.margin < 65 ? 'an-margin--low' : ''}`}>{p.margin.toFixed(1)}%</span>,
    },
  ];

  return (
    <section className="an-card">
      <header className="an-card__head">
        <div>
          <h2>Product Velocity &amp; Top Revenue Drivers</h2>
          <p>{view === 'top' ? 'Top 5 best sellers' : view === 'slow' ? '5 slowest-moving products' : 'Revenue contribution by category'} for the selected period</p>
        </div>
        {products.length > 0 && (
          <div className="an-card__tools">
            <Tabs
              items={[
                { value: 'top', label: 'Best Sellers' },
                { value: 'slow', label: 'Slow Movers' },
                { value: 'category', label: 'Categories' },
              ]}
              value={view}
              onChange={(v) => setView(v as View)}
            />
            {view === 'top' && (
              <Select
                className="an-sort"
                aria-label="Sort products by"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                options={[
                  { value: 'revenue', label: 'Sort: Revenue (₱)' },
                  { value: 'units', label: 'Sort: Units Sold' },
                  { value: 'margin', label: 'Sort: Est. Margin' },
                ]}
              />
            )}
          </div>
        )}
      </header>

      {products.length === 0 ? (
        <EmptyState icon={<PackageSearch size={22} />} title="No product performance data yet" description="Complete product sales to see performance insights." />
      ) : view === 'category' ? (
        <ul className="an-cats">
          {categories.map((c) => (
            <li key={c.category}>
              <span className="an-tag">{c.category}</span>
              <span className="an-cats__track">
                <span style={{ width: `${c.share}%` }} />
              </span>
              <em>{Math.round(c.share)}%</em>
              <span className="an-muted">{c.units} units</span>
              <strong className="an-num">{formatPeso(c.revenue)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <div className="an-table">
          <Table columns={columns} rows={rows} rowKey={(p) => p.code} />
        </div>
      )}
    </section>
  );
}
