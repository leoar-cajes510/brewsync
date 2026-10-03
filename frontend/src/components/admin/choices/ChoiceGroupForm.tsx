import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Minus, Plus, PlusCircle, Power } from 'lucide-react';
import Button from '../../ui/Button';
import Drawer from '../../ui/Drawer';
import Input from '../../ui/Input';
import Tabs from '../../ui/Tabs';
import Toggle from '../../ui/Toggle';
import ChoiceOptionForm from './ChoiceOptionForm';
import type { AdminChoiceGroup, ChoiceGroupDraft, ChoiceOptionDraft, SelectionType } from '../../../types/choice';

let optionSeq = 0;
export const newOption = (): ChoiceOptionDraft => ({ id: `opt-${++optionSeq}`, name: '', price: 0, active: true, isDefault: false });

const blankDraft = (): ChoiceGroupDraft => ({
  name: '',
  displayName: '',
  description: '',
  type: 'single',
  required: false,
  min: 0,
  max: 1,
  active: true,
  options: [newOption(), newOption()],
});

/** Keeps min/max consistent with the type, required flag and option count. */
function normalizeRules(d: ChoiceGroupDraft): ChoiceGroupDraft {
  if (d.type === 'single') return { ...d, min: d.required ? 1 : 0, max: 1 };
  const count = Math.max(d.options.length, 1);
  const max = Math.min(Math.max(d.max, 1), count);
  let min = Math.min(Math.max(d.min, d.required ? 1 : 0), max);
  if (!d.required) min = 0;
  return { ...d, min, max };
}

interface Stepper {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}

function RuleStepper({ label, value, min, max, disabled, onChange }: Stepper) {
  return (
    <div className={`choice-stepper ${disabled ? 'choice-stepper--disabled' : ''}`}>
      <span className="choice-stepper__label">{label}</span>
      <div className="choice-stepper__control">
        <button type="button" aria-label={`Decrease ${label}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>
          <Minus size={13} />
        </button>
        <strong aria-label={label}>{value}</strong>
        <button type="button" aria-label={`Increase ${label}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}

interface ChoiceGroupFormProps {
  open: boolean;
  /** null = creating a new group. */
  group: AdminChoiceGroup | null;
  onClose: () => void;
  onSave: (draft: ChoiceGroupDraft) => void;
  onDuplicate?: (group: AdminChoiceGroup) => void;
  onToggleActive?: (group: AdminChoiceGroup) => void;
}

export default function ChoiceGroupForm({ open, group, onClose, onSave, onDuplicate, onToggleActive }: ChoiceGroupFormProps) {
  const [draft, setDraft] = useState<ChoiceGroupDraft>(blankDraft);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubmitted(false);
    if (group) {
      const { id: _id, code: _code, ...rest } = group;
      setDraft({ ...rest, options: rest.options.map((o) => ({ ...o })) });
    } else {
      setDraft(blankDraft());
    }
  }, [open, group]);

  const update = (patch: Partial<ChoiceGroupDraft>) => setDraft((d) => normalizeRules({ ...d, ...patch }));

  const setType = (type: SelectionType) =>
    setDraft((d) => {
      // Single select allows only one default option.
      let seen = false;
      const options =
        type === 'single'
          ? d.options.map((o) => {
              const keep = o.isDefault && !seen;
              if (keep) seen = true;
              return { ...o, isDefault: keep };
            })
          : d.options;
      const max = type === 'multi' ? Math.max(d.max, Math.min(d.options.length, 2)) : 1;
      return normalizeRules({ ...d, type, options, max });
    });

  const updateOption = (id: string, patch: Partial<ChoiceOptionDraft>) =>
    setDraft((d) => ({
      ...d,
      options: d.options.map((o) => {
        if (o.id === id) return { ...o, ...patch };
        if (patch.isDefault && d.type === 'single') return { ...o, isDefault: false };
        return o;
      }),
    }));

  const addOption = () => setDraft((d) => normalizeRules({ ...d, options: [...d.options, newOption()] }));
  const removeOption = (id: string) => setDraft((d) => normalizeRules({ ...d, options: d.options.filter((o) => o.id !== id) }));

  const nameError = !draft.name.trim() ? 'Choice group name is required.' : undefined;
  const names = draft.options.map((o) => o.name.trim().toLowerCase());
  const optionErrors = draft.options.map((o, i) => {
    if (!o.name.trim()) return 'Option name is required.';
    if (names.indexOf(names[i]) !== i) return 'Duplicate option name.';
    return undefined;
  });
  const activeCount = draft.options.filter((o) => o.active).length;
  const optionsError =
    draft.options.length === 0
      ? 'Add at least one option.'
      : draft.required && activeCount < draft.min
        ? `Required groups need at least ${draft.min} active option${draft.min === 1 ? '' : 's'}.`
        : undefined;
  const valid = !nameError && !optionsError && optionErrors.every((e) => !e);

  const submit = () => {
    setSubmitted(true);
    if (!valid) return;
    onSave({
      ...draft,
      name: draft.name.trim(),
      displayName: draft.displayName.trim(),
      description: draft.description.trim(),
      options: draft.options.map((o) => ({ ...o, name: o.name.trim(), price: Math.round(o.price * 100) / 100 })),
    });
  };

  const optionCap = Math.max(draft.options.length, 1);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span className="choice-form__title">
          {group ? 'Edit Choice Group' : 'Add Choice Group'}
          {group && <span className="code-chip">#{group.code}</span>}
        </span>
      }
      footer={
        <div className="choice-form__footer">
          <Button variant="primary" block icon={<CheckCircle2 size={16} />} onClick={submit}>
            {group ? 'Save Choice Group' : 'Create Choice Group'}
          </Button>
          <div className="choice-form__footer-row">
            {group && onDuplicate && (
              <Button icon={<Copy size={14} />} onClick={() => onDuplicate(group)}>
                Duplicate
              </Button>
            )}
            {group && onToggleActive && (
              <Button className="choice-form__deactivate" icon={<Power size={14} />} onClick={() => onToggleActive(group)}>
                {group.active ? 'Deactivate' : 'Activate'}
              </Button>
            )}
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </div>
      }
    >
      <div className="choice-form">
        <p className="choice-form__intro">Configure the group, its selection rules and options shown at the POS.</p>

        <Input
          label="Choice Group Name"
          placeholder="e.g. Milk Options"
          value={draft.name}
          maxLength={60}
          error={submitted ? nameError : undefined}
          onChange={(e) => update({ name: e.target.value })}
          autoFocus
        />
        <Input
          label="Display Name on POS (optional)"
          placeholder="e.g. Select your milk"
          value={draft.displayName}
          maxLength={60}
          onChange={(e) => update({ displayName: e.target.value })}
        />
        <Input
          label="Description (optional)"
          placeholder="Short note for staff"
          value={draft.description}
          maxLength={120}
          onChange={(e) => update({ description: e.target.value })}
        />

        <div className="choice-form__rules">
          <div className="field">
            <span className="field__label">Selection Type</span>
            <Tabs
              items={[
                { value: 'single', label: 'Single Select' },
                { value: 'multi', label: 'Multi Select' },
              ]}
              value={draft.type}
              onChange={(v) => setType(v as SelectionType)}
            />
          </div>
          <div className="field">
            <span className="field__label">Min / Max Selections</span>
            <div className="choice-form__steppers">
              <RuleStepper
                label="Min"
                value={draft.min}
                min={draft.required ? 1 : 0}
                max={draft.max}
                disabled={draft.type === 'single' || !draft.required}
                onChange={(min) => update({ min })}
              />
              <RuleStepper
                label="Max"
                value={draft.max}
                min={Math.max(draft.min, 1)}
                max={optionCap}
                disabled={draft.type === 'single'}
                onChange={(max) => update({ max })}
              />
            </div>
          </div>
        </div>
        <p className="choice-form__hint">
          {draft.type === 'single'
            ? 'Customer picks exactly one option (radio).'
            : `Customer can pick ${draft.min > 0 ? `${draft.min} to ${draft.max}` : `up to ${draft.max}`} option${draft.max === 1 ? '' : 's'} (checkbox).`}
        </p>

        <div className="choice-form__required">
          <div>
            <strong>Required choice</strong>
            <span>Cashier must choose before adding the item to the order.</span>
          </div>
          <Toggle checked={draft.required} onChange={(required) => update({ required, min: required ? Math.max(draft.min, 1) : 0 })} />
        </div>

        <div className="choice-form__options-head">
          <strong>Options ({draft.options.length})</strong>
          <span>Default options are pre-selected at the POS</span>
        </div>
        <div className="choice-form__options">
          {draft.options.map((o, i) => (
            <ChoiceOptionForm
              key={o.id}
              option={o}
              index={i}
              type={draft.type}
              error={submitted ? optionErrors[i] : undefined}
              canRemove={draft.options.length > 1}
              onChange={(patch) => updateOption(o.id, patch)}
              onRemove={() => removeOption(o.id)}
            />
          ))}
          <button type="button" className="choice-form__add-option" onClick={addOption}>
            <PlusCircle size={15} /> Add Option
          </button>
          {submitted && optionsError && <span className="field__error">{optionsError}</span>}
        </div>
      </div>
    </Drawer>
  );
}
