import { createSectionStore } from './sectionStore';

// Staffing (Settings → Staffing), stored in the `staffing` settings section. The server
// validates the ranges and enforces the account/terminal limits (409 LIMIT_REACHED).
// Staff accounts themselves are managed in Admin → Staff.

export type StaffingKey = 'maxAdmins' | 'maxStaff' | 'maxTerminals' | 'lowStockThreshold' | 'orderWaitingMinutes';

export type StaffingSettings = Record<StaffingKey, number>;

export const STAFFING_DEFAULTS: StaffingSettings = {
  maxAdmins: 2,
  maxStaff: 10,
  maxTerminals: 5,
  lowStockThreshold: 10,
  orderWaitingMinutes: 10,
};

/** Allowed whole-number ranges for each value. */
export const STAFFING_LIMITS: Record<StaffingKey, { min: number; max: number; unit?: string }> = {
  maxAdmins: { min: 1, max: 10 },
  maxStaff: { min: 1, max: 100 },
  maxTerminals: { min: 1, max: 25 },
  lowStockThreshold: { min: 0, max: 10000, unit: 'units' },
  orderWaitingMinutes: { min: 1, max: 240, unit: 'minutes' },
};

const SNAKE: Record<StaffingKey, string> = {
  maxAdmins: 'max_admins',
  maxStaff: 'max_staff',
  maxTerminals: 'max_terminals',
  lowStockThreshold: 'low_stock_threshold',
  orderWaitingMinutes: 'order_waiting_minutes',
};
const KEYS = Object.keys(SNAKE) as StaffingKey[];

const store = createSectionStore<StaffingSettings>(
  'staffing',
  STAFFING_DEFAULTS,
  (d) => Object.fromEntries(KEYS.map((k) => [k, typeof d[SNAKE[k]] === 'number' ? d[SNAKE[k]] : STAFFING_DEFAULTS[k]])) as StaffingSettings,
  (s, current) => ({ ...(current ?? {}), ...Object.fromEntries(KEYS.map((k) => [SNAKE[k], s[k]])) }),
);

export const useStaffingSettings = store.use;
export const saveStaffingSettings = (settings: StaffingSettings) => store.save(settings);

