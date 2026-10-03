import { useEffect, useState } from 'react';
import { api, errorMessage } from './api';
import { REAL_SOURCE, type AnalyticsSource, type Channel, type DateRange } from '../components/admin/analytics/analyticsData';

interface SalesFeedDto {
  start: string;
  end: string;
  timezone: string;
  sales: {
    id: string;
    number: string;
    at: string;
    total: number;
    refunded: number;
    channel: Channel;
    payment: string;
    lines: { product: string; code: string; category: string; qty: number; price: number; cost: number }[];
  }[];
  expenses: { date: string; category: string; amount: number }[];
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const localDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** GET /analytics/sales (✱analytics.view ⚑Analytics): completed sales net of refunds, and expenses. */
export async function getSalesFeed(range: DateRange): Promise<AnalyticsSource> {
  const dto = await api.get<SalesFeedDto>(`/analytics/sales?start=${isoDay(range.start)}&end=${isoDay(range.end)}`);
  return {
    isDemo: false,
    sales: dto.sales.map((s) => ({ id: s.id, at: new Date(s.at), total: s.total, channel: s.channel, payment: s.payment, lines: s.lines })),
    expenses: dto.expenses.map((e) => ({ date: localDay(e.date), category: e.category, amount: e.amount })),
  };
}

/** Loads the feed for a range (re-fetching when it changes); empty while loading or on error. */
export function useSalesFeed(range: DateRange): { source: AnalyticsSource; loading: boolean; error: string | null; reload: () => void } {
  const [source, setSource] = useState<AnalyticsSource>(REAL_SOURCE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const key = `${isoDay(range.start)}_${isoDay(range.end)}`;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSalesFeed(range)
      .then((s) => {
        if (!cancelled) {
          setSource(s);
          setError(null);
        }
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  return { source, loading, error, reload: () => setTick((t) => t + 1) };
}
