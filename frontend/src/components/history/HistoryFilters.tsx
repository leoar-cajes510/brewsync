import { Download } from 'lucide-react';
import Select from '../ui/Select';
import Tabs from '../ui/Tabs';
import type { OrderType } from '../../types/order';
import type { PaymentMethod } from '../../types/payment';
import type { ReceiptStatus } from '../../types/receipt';

export type DateRange = 'today' | 'yesterday' | 'week' | 'all';

export interface HistoryFilterState {
  date: DateRange;
  type: 'all' | OrderType;
  payment: 'all' | PaymentMethod;
  cashier: string;
  status: 'all' | ReceiptStatus;
}

export const defaultHistoryFilters: HistoryFilterState = {
  date: 'today',
  type: 'all',
  payment: 'all',
  cashier: 'all',
  status: 'all',
};

const typeTabs = [
  { value: 'all', label: 'All Types' },
  { value: 'dine-in', label: 'Dine-In' },
  { value: 'takeout', label: 'Takeout' },
  { value: 'delivery', label: 'Delivery' },
];

const paymentTabs = [
  { value: 'all', label: 'All Payments' },
  { value: 'cash', label: 'Cash' },
  { value: 'gcash', label: 'GCash / QRPh' },
  { value: 'card', label: 'Card' },
  { value: 'bank-transfer', label: 'Bank Transfer' },
];

interface HistoryFiltersProps {
  value: HistoryFilterState;
  onChange: (next: HistoryFilterState) => void;
  cashiers: string[];
  todayLabel: string;
}

export default function HistoryFilters({ value, onChange, cashiers, todayLabel }: HistoryFiltersProps) {
  const set = <K extends keyof HistoryFilterState>(key: K, v: HistoryFilterState[K]) => onChange({ ...value, [key]: v });

  return (
    <div className="history-filters">
      <Select
        className="history-filters__date"
        aria-label="Date range"
        value={value.date}
        onChange={(e) => set('date', e.target.value as DateRange)}
        options={[
          { value: 'today', label: `Today, ${todayLabel}` },
          { value: 'yesterday', label: 'Yesterday' },
          { value: 'week', label: 'Last 7 Days' },
          { value: 'all', label: 'All Dates' },
        ]}
      />
      <div className="history-filters__group">
        <Tabs items={typeTabs} value={value.type} onChange={(v) => set('type', v as HistoryFilterState['type'])} />
      </div>
      <div className="history-filters__group">
        <Tabs items={paymentTabs} value={value.payment} onChange={(v) => set('payment', v as HistoryFilterState['payment'])} />
      </div>
      <div className="history-filters__selects">
        <label className="inline-select">
          <span>Cashier:</span>
          <Select
            aria-label="Cashier"
            value={value.cashier}
            onChange={(e) => set('cashier', e.target.value)}
            options={[{ value: 'all', label: 'All Cashiers' }, ...cashiers.map((c) => ({ value: c, label: c }))]}
          />
        </label>
        <label className="inline-select">
          <span>Status:</span>
          <Select
            aria-label="Status"
            value={value.status}
            onChange={(e) => set('status', e.target.value as HistoryFilterState['status'])}
            options={[
              { value: 'all', label: 'All Statuses' },
              { value: 'completed', label: 'Completed' },
              { value: 'refunded', label: 'Refunded' },
              { value: 'partial-refund', label: 'Partially Refunded' },
            ]}
          />
        </label>
        <button type="button" className="icon-btn" aria-label="Export" title="Export (available in a later phase)" disabled>
          <Download size={15} />
        </button>
      </div>
    </div>
  );
}
