import { useCallback, useEffect, useMemo, useState } from 'react';
import KPISection from '../../components/admin/overview/KPISection';
import SalesOverview from '../../components/admin/overview/SalesOverview';
import AttentionSection from '../../components/admin/overview/AttentionSection';
import BestSellers from '../../components/admin/overview/BestSellers';
import LowStock from '../../components/admin/overview/LowStock';
import QuickActions from '../../components/admin/overview/QuickActions';
import RecentOrders from '../../components/admin/overview/RecentOrders';
import LoadingState from '../../components/ui/LoadingState';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import { EXPENSE_CATEGORIES } from '../../services/expenseService';
import { loadOverview, salesSeries, type OverviewData, type SalesPeriod } from './adminOverviewData';
import '../../components/admin/overview/overview.css';

// Rendered inside the shared Admin SectionLayout (header + Admin tabs).
// Every figure comes from persisted records via the API; nothing is seeded or simulated.
export default function AdminOverviewPage() {
  const [period, setPeriod] = useState<SalesPeriod>('today');
  const [data, setData] = useState<OverviewData | null>(null);

  const refresh = useCallback(() => {
    void loadOverview().then(setData);
  }, []);

  useEffect(refresh, [refresh]);
  const series = useMemo(() => (data?.feed ? salesSeries(data.feed, period) : null), [data, period]);

  if (!data) return <LoadingState label="Loading overview…" />;

  return (
    <div className="admin-overview">
      {data.errors.length > 0 && (
        <EmptyState title="Some overview data could not be loaded" description={data.errors.join(' · ')} action={<Button onClick={refresh}>Try again</Button>} />
      )}

      <KPISection kpis={data.kpis} />

      <div className="ov-row ov-row--main">
        <SalesOverview period={period} onPeriodChange={setPeriod} series={series} />
        <AttentionSection items={data.attention} />
      </div>

      <div className="ov-row ov-row--three">
        <BestSellers items={data.bestSellers} />
        <LowStock items={data.lowStock} />
        <QuickActions categories={data.categories} expenseCategories={EXPENSE_CATEGORIES} onRecorded={refresh} />
      </div>

      <RecentOrders orders={data.recentOrders} />
    </div>
  );
}
