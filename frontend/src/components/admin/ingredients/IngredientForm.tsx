import { useEffect, useState } from 'react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Modal from '../../ui/Modal';
import Select from '../../ui/Select';
import { useStaffingSettings } from '../../../stores/staffingSettingsStore';
import { INGREDIENT_UNITS, type Ingredient, type IngredientDraft } from '../../../types/ingredient';

const CUSTOM = '__custom__';

interface IngredientFormProps {
  open: boolean;
  /** null = adding a new ingredient. */
  ingredient: Ingredient | null;
  categories: string[];
  existingNames: string[];
  onClose: () => void;
  onSave: (draft: IngredientDraft) => void;
}

interface FormText {
  name: string;
  category: string;
  unitChoice: string;
  customUnit: string;
  stock: string;
  cost: string;
  threshold: string;
  notes: string;
}

const blank: FormText = { name: '', category: '', unitChoice: 'g', customUnit: '', stock: '0', cost: '', threshold: '', notes: '' };

export default function IngredientForm({ open, ingredient, categories, existingNames, onClose, onSave }: IngredientFormProps) {
  const [f, setF] = useState<FormText>(blank);
  const [submitted, setSubmitted] = useState(false);

  // Settings → Staffing → Low Stock Threshold is the starting value for a NEW ingredient (Q-INV-4: default only).
  const { settings: staffing, loaded: staffingLoaded } = useStaffingSettings();
  const defaultThreshold = staffingLoaded ? String(staffing.lowStockThreshold) : '';

  useEffect(() => {
    if (!open) return;
    setSubmitted(false);
    if (!ingredient) return setF({ ...blank, threshold: defaultThreshold });
    const known = INGREDIENT_UNITS.includes(ingredient.unit);
    setF({
      name: ingredient.name,
      category: ingredient.category,
      unitChoice: known ? ingredient.unit : CUSTOM,
      customUnit: known ? '' : ingredient.unit,
      stock: String(ingredient.stock),
      cost: String(ingredient.cost),
      threshold: String(ingredient.threshold),
      notes: ingredient.notes,
    });
  }, [open, ingredient]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when opened

  useEffect(() => {
    if (open && !ingredient && defaultThreshold) setF((x) => (x.threshold === '' ? { ...x, threshold: defaultThreshold } : x));
  }, [open, ingredient, defaultThreshold]);

  const set = (patch: Partial<FormText>) => setF((x) => ({ ...x, ...patch }));
  const unit = f.unitChoice === CUSTOM ? f.customUnit.trim() : f.unitChoice;
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

  const errors = {
    name: !f.name.trim()
      ? 'Ingredient name is required.'
      : existingNames.some((n) => n.toLowerCase() === f.name.trim().toLowerCase())
        ? 'An ingredient with this name already exists.'
        : undefined,
    unit: !unit ? 'Enter a unit.' : undefined,
    stock: !(num(f.stock) >= 0) ? 'Enter 0 or more.' : undefined,
    cost: !(num(f.cost) >= 0) ? 'Enter a cost of 0 or more.' : undefined,
    threshold: !(num(f.threshold) >= 0) ? 'Enter 0 or more.' : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);

  const submit = () => {
    setSubmitted(true);
    if (!valid) return;
    onSave({
      name: f.name.trim(),
      category: f.category.trim() || 'Uncategorized',
      unit,
      stock: num(f.stock),
      cost: Math.round(num(f.cost) * 10000) / 10000,
      threshold: num(f.threshold),
      notes: f.notes.trim(),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={ingredient ? `Edit Ingredient · #${ingredient.code}` : 'Add Ingredient'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            {ingredient ? 'Save Changes' : 'Add Ingredient'}
          </Button>
        </>
      }
    >
      <div className="ing-form">
        <Input
          className="ing-form__wide"
          label="Ingredient Name"
          placeholder="e.g. Espresso Beans"
          value={f.name}
          maxLength={60}
          error={err('name')}
          onChange={(e) => set({ name: e.target.value })}
          autoFocus
        />
        <div className="field ing-form__wide">
          <Input
            label="Category (optional)"
            placeholder="e.g. Coffee & Espresso"
            list="ing-category-list"
            value={f.category}
            maxLength={40}
            onChange={(e) => set({ category: e.target.value })}
          />
          <datalist id="ing-category-list">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <Select
          label="Unit"
          value={f.unitChoice}
          onChange={(e) => set({ unitChoice: e.target.value })}
          // Units are fixed by R4a.1 (g, kg, ml, L, pcs); the server rejects anything else.
          options={INGREDIENT_UNITS.map((u) => ({ value: u, label: u }))}
        />
        {f.unitChoice === CUSTOM ? (
          <Input label="Custom Unit" placeholder="e.g. btl, tray" value={f.customUnit} maxLength={12} error={err('unit')} onChange={(e) => set({ customUnit: e.target.value })} />
        ) : (
          <span className="ing-form__spacer" />
        )}
        {ingredient ? (
          <div className="field">
            <span className="field__label">Current Stock</span>
            <p className="ing-form__readonly">
              {ingredient.stock} {ingredient.unit} <em>Use Restock / Adjust to change</em>
            </p>
          </div>
        ) : (
          <Input label={`Initial Stock (${unit || 'unit'})`} type="number" min={0} step="any" value={f.stock} error={err('stock')} onChange={(e) => set({ stock: e.target.value })} />
        )}
        <Input
          label={`Cost per ${unit || 'unit'} (₱)`}
          type="number"
          min={0}
          step="0.01"
          placeholder="0.00"
          value={f.cost}
          error={err('cost')}
          onChange={(e) => set({ cost: e.target.value })}
        />
        <Input
          label={`Low Stock Threshold (${unit || 'unit'})`}
          type="number"
          min={0}
          step="any"
          placeholder="e.g. 500"
          value={f.threshold}
          error={err('threshold')}
          hint="Marked Low Stock at or below this amount."
          onChange={(e) => set({ threshold: e.target.value })}
        />
        <div className="field ing-form__wide">
          <label className="field__label" htmlFor="ing-notes">
            Notes (optional)
          </label>
          <textarea
            id="ing-notes"
            className="input ing-form__notes"
            placeholder="Supplier, storage, brand…"
            maxLength={200}
            value={f.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </div>
      </div>
    </Modal>
  );
}
