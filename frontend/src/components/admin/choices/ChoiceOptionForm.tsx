import { useState } from 'react';
import { AlertTriangle, GripVertical, Plus, Trash2, X } from 'lucide-react';
import Toggle from '../../ui/Toggle';
import type { ChoiceEffectDraft, ChoiceOptionDraft, EffectMode, SelectionType } from '../../../types/choice';

/** Ingredient choices for the effects editor (active ingredients plus any already referenced). */
export interface EffectIngredient {
  id: string;
  name: string;
  unit: string;
  active: boolean;
}

interface ChoiceOptionFormProps {
  option: ChoiceOptionDraft;
  index: number;
  type: SelectionType;
  error?: string;
  canRemove: boolean;
  /** Present only when the user may edit recipes and Ingredient Tracking is on. */
  ingredients?: EffectIngredient[];
  onChange: (patch: Partial<ChoiceOptionDraft>) => void;
  onRemove: () => void;
}

const blankEffect = (mode: EffectMode): ChoiceEffectDraft => ({ mode, ingredientId: '', replacesId: '', quantity: '' });

// One editable option row: name, additional price, default, active, remove — plus its ingredient
// effects (SCALE the base recipe, ADD an ingredient, or REPLACE a recipe ingredient) when ingredient
// editing is allowed.
export default function ChoiceOptionForm({ option, index, type, error, canRemove, ingredients, onChange, onRemove }: ChoiceOptionFormProps) {
  // Local text so the field can be cleared/edited freely; empty = free (₱0).
  const [priceText, setPriceText] = useState(option.price ? String(option.price) : '');
  const label = option.name.trim() || `Option ${index + 1}`;
  const byId = new Map((ingredients ?? []).map((i) => [i.id, i]));
  const selectable = (current: string) => (ingredients ?? []).filter((i) => i.active || i.id === current);
  const setEffect = (i: number, patch: Partial<ChoiceEffectDraft>) =>
    onChange({ effects: option.effects.map((e, j) => (j === i ? { ...e, ...patch } : e)) });

  const ingredientSelect = (value: string, aria: string, onPick: (id: string) => void, placeholder: string) => (
    <select className="input select choice-effect__select" aria-label={aria} value={value} onChange={(e) => onPick(e.target.value)}>
      <option value="">{placeholder}</option>
      {selectable(value).map((i) => (
        <option key={i.id} value={i.id}>
          {i.name}
          {i.active ? '' : ' (inactive)'}
        </option>
      ))}
    </select>
  );

  return (
    <div className={`choice-option-row ${option.active ? '' : 'choice-option-row--inactive'}`}>
      <div className="choice-option-row__main">
        <GripVertical size={14} className="choice-option-row__grip" aria-hidden />
        <input
          className={`input choice-option-row__name ${error ? 'input--error' : ''}`}
          placeholder={`Option ${index + 1} name`}
          aria-label={`Option ${index + 1} name`}
          value={option.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <label className="choice-option-row__price">
          <span>+₱</span>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            aria-label={`Option ${index + 1} additional price`}
            value={priceText}
            onChange={(e) => {
              setPriceText(e.target.value);
              const n = Number(e.target.value);
              onChange({ price: Number.isFinite(n) && n > 0 ? n : 0 });
            }}
            onBlur={() => setPriceText(option.price ? String(option.price) : '')}
            placeholder="0.00"
          />
        </label>
        <button
          type="button"
          className="icon-btn choice-option-row__remove"
          aria-label={`Remove option ${index + 1}`}
          disabled={!canRemove}
          onClick={onRemove}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div className="choice-option-row__meta">
        <label className="choice-option-row__default">
          <input
            type={type === 'single' ? 'radio' : 'checkbox'}
            name="choice-default"
            checked={option.isDefault}
            onChange={(e) => onChange({ isDefault: type === 'single' ? true : e.target.checked })}
            onClick={() => type === 'single' && option.isDefault && onChange({ isDefault: false })}
          />
          Default
        </label>
        <Toggle checked={option.active} onChange={(active) => onChange({ active })} label={option.active ? 'Active' : 'Inactive'} />
      </div>

      {ingredients && (
        <div className="choice-effects">
          <span className="choice-effects__title">Ingredient effects</span>
          {option.effects.length === 0 && <span className="choice-effects__empty">No recipe change.</span>}
          {option.effects.map((e, i) => {
            const unit = byId.get(e.ingredientId)?.unit ?? '';
            if (e.mode === 'scale')
              return (
                <div key={i} className="choice-effect">
                  <span className="choice-effect__word choice-effect__scale-label">Scale whole recipe</span>
                  <label className="choice-effect__qty">
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step="0.05"
                      inputMode="decimal"
                      aria-label={`${label} recipe scale factor`}
                      value={e.quantity}
                      placeholder="1.0"
                      onChange={(ev) => setEffect(i, { quantity: ev.target.value })}
                    />
                    <span>×</span>
                  </label>
                  <button
                    type="button"
                    className="icon-btn choice-effect__remove"
                    aria-label={`Remove ${label} scale factor`}
                    onClick={() => onChange({ effects: option.effects.filter((_, j) => j !== i) })}
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            return (
              <div key={i} className="choice-effect">
                <select
                  className="input select choice-effect__mode"
                  aria-label={`${label} effect ${i + 1} type`}
                  value={e.mode}
                  onChange={(ev) => setEffect(i, { mode: ev.target.value as EffectMode, replacesId: '' })}
                >
                  <option value="add">Add</option>
                  <option value="replace">Replace</option>
                </select>
                {e.mode === 'replace' && (
                  <>
                    {ingredientSelect(e.replacesId, `${label} effect ${i + 1} recipe ingredient to replace`, (id) => setEffect(i, { replacesId: id }), 'Recipe ingredient…')}
                    <span className="choice-effect__word">with</span>
                  </>
                )}
                {ingredientSelect(
                  e.ingredientId,
                  `${label} effect ${i + 1} ${e.mode === 'add' ? 'ingredient' : 'replacement ingredient'}`,
                  (id) => setEffect(i, { ingredientId: id }),
                  e.mode === 'add' ? 'Ingredient…' : 'Replacement…',
                )}
                <label className="choice-effect__qty">
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    inputMode="decimal"
                    aria-label={`${label} effect ${i + 1} quantity`}
                    value={e.quantity}
                    placeholder="0"
                    onChange={(ev) => setEffect(i, { quantity: ev.target.value })}
                  />
                  <span>{unit}</span>
                </label>
                <button
                  type="button"
                  className="icon-btn choice-effect__remove"
                  aria-label={`Remove ${label} effect ${i + 1}`}
                  onClick={() => onChange({ effects: option.effects.filter((_, j) => j !== i) })}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
          <div className="choice-effects__add">
            {!option.effects.some((e) => e.mode === 'scale') && (
              <button type="button" onClick={() => onChange({ effects: [{ ...blankEffect('scale'), quantity: '1' }, ...option.effects] })}>
                <Plus size={13} /> Scale recipe
              </button>
            )}
            <button type="button" onClick={() => onChange({ effects: [...option.effects, blankEffect('add')] })}>
              <Plus size={13} /> Add ingredient
            </button>
            <button type="button" onClick={() => onChange({ effects: [...option.effects, blankEffect('replace')] })}>
              <Plus size={13} /> Replace ingredient
            </button>
          </div>
          {option.effects.some((e) => e.mode === 'scale') && (
            <span className="choice-effects__hint">
              Scaling multiplies the base recipe (and replacements) before add-ons; e.g. Large 1.5× turns 18 g into 27 g.
            </span>
          )}
          {option.effects.some((e) => e.mode === 'replace') && (
            <span className="choice-effects__hint">A replacement applies only to products whose base recipe contains that ingredient.</span>
          )}
          {!!option.effectWarnings?.length && (
            <span className="choice-effects__warning">
              <AlertTriangle size={13} /> Ignored for {option.effectWarnings.join(', ')}: the replaced ingredient is not in their recipe.
            </span>
          )}
        </div>
      )}
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}
