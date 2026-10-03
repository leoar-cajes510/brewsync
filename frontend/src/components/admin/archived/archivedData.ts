import type { Receipt } from '../../../types/receipt';

// An archived order is a completed/closed order moved out of the active Orders
// workflow. It carries the same data as its receipt plus archive audit info.
// Loaded from GET /archive.
export interface ArchivedOrder extends Receipt {
  archivedAt: Date;
  /** Who/what archived it, e.g. "System · Shift Close" or a staff name. */
  archivedBy: string;
  note?: string;
  /** Server order status (completed / cancelled). */
  orderStatus: string;
}

/** Only completed orders can be restored; the restore window (Settings → Archiving) is enforced by the server. */
export const canRestore = (o: ArchivedOrder) => o.orderStatus === 'completed';

export type DatePreset = 'all' | 'today' | 'week' | 'month' | 'last-month';

export const DATE_LABELS: Record<DatePreset, string> = {
  all: 'All Time',
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  'last-month': 'Last Month',
};

export function inDatePreset(d: Date, preset: DatePreset, now = new Date()): boolean {
  if (preset === 'all') return true;
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === 'today') return d >= day;
  if (preset === 'week') {
    const start = new Date(day);
    start.setDate(day.getDate() - ((day.getDay() + 6) % 7));
    return d >= start;
  }
  if (preset === 'month') return d >= new Date(now.getFullYear(), now.getMonth(), 1);
  return d >= new Date(now.getFullYear(), now.getMonth() - 1, 1) && d < new Date(now.getFullYear(), now.getMonth(), 1);
}
