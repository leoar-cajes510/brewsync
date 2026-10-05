// Response/request shapes of the BrewSync API (backend services' DTOs).
// Money is always a decimal string ("165.00"); the client never rounds authoritative values.

export type Money = string;

export type RoleKey = 'admin' | 'cashier';
export type AuthMethod = 'password' | 'pin';

export interface SetupStatusDto {
  setup_status: 'not_started' | 'in_progress' | 'completed';
}

export interface LoginResponse {
  token: string;
  token_type: 'bearer';
  user: { id: string; username: string; full_name: string; role: RoleKey; must_change_credential: boolean };
  terminal_id: string | null;
}

export interface MeDto {
  user_id: string;
  code?: string;
  username?: string;
  full_name: string;
  role: RoleKey;
  auth_method?: AuthMethod;
  permissions: string[];
  terminal_id: string | null;
  terminal_code?: string | null;
  terminal_name?: string | null;
  must_change_credential: boolean;
}

export interface TerminalDto {
  id: string;
  code: string;
  name: string;
  status: string;
  [key: string]: unknown;
}

export interface TerminalRegistered extends TerminalDto {
  activation_code: string;
  activation_expires_at: string;
}

export interface TerminalActivated {
  terminal: TerminalDto;
  device_credential: string;
}

export interface StaffDto {
  id: string;
  code: string;
  username: string;
  full_name: string;
  role: RoleKey;
  auth_method: AuthMethod;
  status: string;
  must_change_credential: boolean;
}

export interface CategoryDto {
  id: string;
  name: string;
  /** Fixed at creation; generated product codes are `${code_prefix}-NNN`. */
  code_prefix: string;
  sort_order: number;
  active: boolean;
}

export type TaxClass = 'taxable' | 'non_taxable';

export interface ProductDto {
  id: string;
  code: string;
  name: string;
  description: string;
  category_id: string;
  price: Money;
  image_url: string | null;
  available: boolean;
  active: boolean;
  track_units: boolean;
  track_ingredients: boolean;
  tax_class: TaxClass;
  choice_group_ids: string[];
  updated_at?: string;
}

/** Ingredient effect of a choice option (R4a.3a), in the ingredient's own unit.
 * 'scale' multiplies the whole base recipe: no ingredient, `quantity` is the factor (e.g. "1.500"). */
export interface ChoiceEffectDto {
  mode: 'scale' | 'add' | 'replace';
  ingredient_id: string | null;
  /** Base-recipe ingredient a REPLACE swaps out; null for ADD. */
  replaces_ingredient_id: string | null;
  quantity: string;
}

export interface ChoiceOptionDto {
  id: string;
  name: string;
  price_delta: Money;
  active?: boolean;
  is_default?: boolean;
  effects?: ChoiceEffectDto[];
  /** Products whose recipe lacks an ingredient this option's REPLACE would swap (it is ignored there). */
  effect_warnings?: string[];
}

export interface ChoiceGroupDto {
  id: string;
  code: string;
  name: string;
  display_name?: string;
  description?: string;
  selection_type: 'single' | 'multi';
  required: boolean;
  min_select: number;
  max_select: number;
  active?: boolean;
  options: ChoiceOptionDto[];
}

export interface DiscountDto {
  id: string;
  name: string;
  type: 'percentage' | 'fixed';
  value: string;
  eligibility: string;
  custom_eligibility: string;
  min_order: Money | null;
  max_discount: Money | null;
  active: boolean;
  requires_identification: boolean;
  identification_fields: string[];
}

export type StockStatusDto = 'in_stock' | 'low' | 'out' | string;

export interface StockLevelDto {
  subject_type: 'product' | 'ingredient';
  subject_id: string;
  on_hand: string;
  reserved: string;
  available: string;
  low_stock_threshold: string;
  status: StockStatusDto;
}

export type OrderStatusDto = 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled';
export type PaymentStatusDto = 'unpaid' | 'partially_paid' | 'paid';
export type OrderTypeDto = 'dine_in' | 'takeout' | 'delivery';
export type PaymentMethodDto = 'cash' | 'gcash' | 'card' | 'bank_transfer';

export interface OrderItemDto {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: Money;
  line_total: Money;
  tax_class: TaxClass;
  discount_allocation: Money;
  choices: { group: string; option: string; price_delta: Money }[];
}

export interface TotalsDto {
  subtotal: Money;
  discount_total: Money;
  net_amount: Money;
  tax_amount: Money;
  total: Money;
  tax_breakdown?: { tax_class: TaxClass; taxable_amount: Money; tax_amount: Money }[];
}

export interface PaymentDto {
  id: string;
  method: PaymentMethodDto;
  amount: Money;
  status: 'pending' | 'completed' | 'voided';
  tendered: Money | null;
  change_given: Money | null;
  rounding_adjustment: Money;
  reference: string | null;
}

export interface DocumentRefDto {
  id: string;
  number: string;
  status?: string;
}

export interface OrderDto {
  id: string;
  number: string;
  origin: string;
  order_type: OrderTypeDto;
  tag: string | null;
  note: string | null;
  status: OrderStatusDto;
  payment_status: PaymentStatusDto;
  refund_status: 'none' | 'partially_refunded' | 'refunded';
  version: number;
  created_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  archived_at: string | null;
  archived_by?: string | null;
  cashier_id?: string;
  cashier_name?: string | null;
  archived_by_name?: string | null;
  archive_reason?: string | null;
  items: OrderItemDto[];
  discount: { name: string; amount: Money; identification_captured: boolean; id_number_masked: string | null } | null;
  totals: TotalsDto;
  amount_due: Money;
  payments: PaymentDto[];
  refunds: { id: string; kind: string; amount: Money; reason: string }[];
}

export interface QuoteDto {
  subtotal: Money;
  discount_total: Money;
  tax_amount: Money;
  net_amount: Money;
  total: Money;
}

export interface PaymentResultDto extends OrderDto {
  payment: { id: string; status: string; amount: Money; change_given: Money | null; rounding_adjustment: Money };
  document?: DocumentRefDto;
}

export interface DocumentSnapshot {
  document_title: string | null;
  business: { name: string; address: string; phone: string; email: string };
  order: { number: string; type: OrderTypeDto; tag: string | null };
  items: { name: string; code: string; quantity: number; unit_price: Money; line_total: Money; choices: { group: string; option: string; price_delta: Money }[] }[];
  discount: { name: string; amount: Money } | null;
  totals: TotalsDto & { tax_name: string; tax_rate: string | null; tax_mode: string | null };
  payments: { method: PaymentMethodDto; amount: Money; reference: string | null; tendered: Money | null; change: Money | null; rounding_adjustment: Money }[];
  cashier: string;
  terminal: string | null;
  display: Record<string, unknown> | null;
}

export interface DocumentDto {
  id: string;
  document_type: string;
  number: string;
  order_id: string | null;
  issued_at: string;
  status: string;
  print_count: number;
  snapshot: DocumentSnapshot;
  prints?: { print_number: number; is_reprint: boolean; printed_at: string; actor_id: string }[];
}

export interface HistoryOrderDto extends OrderDto {
  document: DocumentRefDto | null;
}

export interface HistoryDetailDto extends OrderDto {
  document: DocumentDto | null;
}

export interface SettingsSectionDto<T = Record<string, unknown>> {
  section: string;
  configured: boolean;
  version?: number;
  data?: T;
}

export interface ExpenseDto {
  id: string;
  code: string;
  category: string;
  description: string;
  amount: Money;
  expense_date: string;
  payment_method: string;
  notes: string;
  recorded_by: string;
  created_at?: string;
}

export interface StockMovementDto {
  id: string;
  type: string;
  delta_on_hand: string;
  delta_reserved: string;
  on_hand_after: string;
  reserved_after: string;
  reason: string | null;
  note: string | null;
  unit_cost: string | null;
  reference_type: string;
  reference_id: string | null;
  actor_id: string | null;
  created_at: string;
}

export type IngredientUnitDto = 'g' | 'kg' | 'ml' | 'L' | 'pcs';

export interface IngredientDto {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: IngredientUnitDto;
  unit_cost: string;
  notes: string;
  active: boolean;
  stock: StockLevelDto | null;
}

export interface RecipeDto {
  product_id: string;
  /** Recipe consumed on every sale (reserved at order creation, Q-INV-1/Q-INV-2). */
  track_ingredients?: boolean;
  lines: { ingredient_id: string; quantity: string }[];
}
