// Admin → Choices: reusable customization groups (Size, Milk, Sweetness…).
// Persisted via /choice-groups and linked to products in Admin → Products.

export type SelectionType = 'single' | 'multi';

export type EffectMode = 'scale' | 'add' | 'replace';

/** What the option does to the recipe of ONE unit (R4a.3a). Quantity is in the ingredient's unit;
 * for 'scale' it is the factor applied to the whole base recipe (no ingredient). */
export interface ChoiceEffectDraft {
  mode: EffectMode;
  /** Empty for 'scale'. */
  ingredientId: string;
  /** REPLACE only: the base-recipe ingredient swapped out. */
  replacesId: string;
  quantity: string;
}

export interface ChoiceOptionDraft {
  id: string;
  name: string;
  /** Additional price in pesos; 0 = free. */
  price: number;
  active: boolean;
  isDefault: boolean;
  effects: ChoiceEffectDraft[];
  /** Server advisory: products where a REPLACE effect is ignored (source not in their recipe). */
  effectWarnings?: string[];
}

/** First problem with an option's effects, or undefined when they can be saved. */
export function effectError(effects: ChoiceEffectDraft[]): string | undefined {
  for (const e of effects) {
    if (e.mode === 'scale') {
      const f = Number(e.quantity);
      if (!(f > 0) || f > 10) return 'Scale factor must be greater than 0 and at most 10.';
      continue;
    }
    if (!e.ingredientId) return e.mode === 'add' ? 'Choose the ingredient to add.' : 'Choose the replacement ingredient.';
    if (e.mode === 'replace' && !e.replacesId) return 'Choose the recipe ingredient to replace.';
    if (e.mode === 'replace' && e.replacesId === e.ingredientId) return 'An ingredient cannot replace itself.';
    if (!(Number(e.quantity) > 0)) return 'Effect quantity must be greater than 0.';
  }
  if (effects.filter((e) => e.mode === 'scale').length > 1) return 'An option can have only one scale factor.';
  const used = effects.filter((e) => e.mode !== 'scale').map((e) => e.ingredientId);
  if (new Set(used).size !== used.length) return 'Each ingredient can appear once per option.';
  const replaced = effects.filter((e) => e.mode === 'replace').map((e) => e.replacesId);
  if (new Set(replaced).size !== replaced.length) return 'An option can replace the same ingredient only once.';
  return undefined;
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
