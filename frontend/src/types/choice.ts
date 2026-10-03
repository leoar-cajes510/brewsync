// Admin → Choices: reusable customization groups (Size, Milk, Sweetness…).
// Persisted via /choice-groups and linked to products in Admin → Products.

export type SelectionType = 'single' | 'multi';

export interface ChoiceOptionDraft {
  id: string;
  name: string;
  /** Additional price in pesos; 0 = free. */
  price: number;
  active: boolean;
  isDefault: boolean;
}

export interface ChoiceGroupDraft {
  name: string;
  displayName: string;
  description: string;
  type: SelectionType;
  required: boolean;
  min: number;
  max: number;
  active: boolean;
  options: ChoiceOptionDraft[];
}

export interface AdminChoiceGroup extends ChoiceGroupDraft {
  id: string;
  code: string;
}

export const SELECTION_TYPE_LABEL: Record<SelectionType, string> = {
  single: 'Single Select',
  multi: 'Multi Select',
};

/** Human summary of the selection rule, e.g. "Pick 1", "Pick 1–3", "Up to 5". */
export function selectionRule(g: Pick<ChoiceGroupDraft, 'type' | 'min' | 'max'>): string {
  if (g.type === 'single') return 'Pick 1';
  if (g.min === 0) return `Up to ${g.max}`;
  if (g.min === g.max) return `Pick ${g.min}`;
  return `Pick ${g.min}–${g.max}`;
}
