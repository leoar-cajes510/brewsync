import { useState } from 'react';
import { GripVertical, Trash2 } from 'lucide-react';
import Toggle from '../../ui/Toggle';
import type { ChoiceOptionDraft, SelectionType } from '../../../types/choice';

interface ChoiceOptionFormProps {
  option: ChoiceOptionDraft;
  index: number;
  type: SelectionType;
  error?: string;
  canRemove: boolean;
  onChange: (patch: Partial<ChoiceOptionDraft>) => void;
  onRemove: () => void;
}

// One editable option row: name, additional price, default, active, remove.
export default function ChoiceOptionForm({ option, index, type, error, canRemove, onChange, onRemove }: ChoiceOptionFormProps) {
  // Local text so the field can be cleared/edited freely; empty = free (₱0).
  const [priceText, setPriceText] = useState(option.price ? String(option.price) : '');
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
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}
