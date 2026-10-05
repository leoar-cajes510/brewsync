import { useEffect, useState } from 'react';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import Input from '../../ui/Input';
import Modal from '../../ui/Modal';
import Select from '../../ui/Select';
import Tabs from '../../ui/Tabs';
import Toggle from '../../ui/Toggle';
import { StockPreview } from '../inventory/inventoryShared';
import { roundQty, type Ingredient } from '../../../types/ingredient';

/** restock = receive a purchase · adjust = correction/loss · waste = non-sale deduction · count = physical count. */
export type StockMode = 'restock' | 'adjust' | 'waste' | 'count';

const ADJUST_REASONS = ['Damaged', 'Lost', 'Other'];
/** Server waste reasons (never recorded as sales). */
export const WASTE_REASONS = [
  { value: 'expired', label: 'Expired' },
  { value: 'spilled', label: 'Spilled' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'spoiled', label: 'Spoiled' },
  { value: 'preparation', label: 'Preparation waste' },
  { value: 'other', label: 'Other' },
];

export interface StockChange {
  mode: StockMode;
  /** Signed change of on-hand stock (count: counted − current). */
  delta: number;
  reason: string;
  note: string;
  unitCost?: string;
  supplier?: string;
  updateCost?: boolean;
  counted?: number;
}

interface IngredientStockProps {
  ingredient: Ingredient | null;
  mode: StockMode;
  onClose: () => void;
  onApply: (ingredient: Ingredient, change: StockChange) => void;
}

const TITLES: Record<StockMode, string> = { restock: 'Receive Stock', adjust: 'Adjust Stock', waste: 'Record Waste', count: 'Physical Count' };

// Stock movements for one ingredient. Always shows current → new on-hand stock and asks for
// confirmation; the server records the movement and is the authority on every rule.
export default function IngredientStock({ ingredient, mode: initialMode, onClose, onApply }: IngredientStockProps) {
  const [mode, setMode] = useState<StockMode>(initialMode);
  const [direction, setDirection] = useState<'increase' | 'decrease'>('decrease');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [updateCost, setUpdateCost] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const defaultReason = (m: StockMode) => (m === 'adjust' ? ADJUST_REASONS[0] : m === 'waste' ? WASTE_REASONS[0].value : m === 'count' ? 'Scheduled count' : '');

  useEffect(() => {
    if (!ingredient) return;
    setMode(initialMode);
    setDirection('decrease');
    setQty('');
    setNote('');
    setUnitCost('');
    setSupplier('');
    setUpdateCost(false);
    setReason(defaultReason(initialMode));
    setSubmitted(false);
    setConfirming(false);
  }, [ingredient, initialMode]);

  useEffect(() => setReason(defaultReason(mode)), [mode]);

  if (!ingredient) return null;

  const unit = ingredient.unit;
  const amount = qty.trim() === '' ? NaN : Number(qty);
  const reserved = ingredient.reserved ?? 0;
  let delta = 0;
  if (Number.isFinite(amount)) {
    if (mode === 'count') delta = roundQty(amount - ingredient.stock);
    else delta = roundQty((mode === 'restock' || (mode === 'adjust' && direction === 'increase') ? 1 : -1) * amount);
  }
  const next = roundQty(ingredient.stock + delta);
  const qtyError =
    mode === 'count'
      ? !(amount >= 0)
        ? 'Enter the counted quantity (0 or more).'
        : amount < reserved
          ? `${reserved} ${unit} is reserved for open orders; the count cannot be lower. Complete or cancel those orders first.`
          : undefined
      : !(amount > 0)
        ? 'Enter a quantity greater than 0.'
        : next < reserved && delta < 0
          ? `Only ${roundQty(ingredient.stock - reserved)} ${unit} can be removed (${reserved} ${unit} is reserved for open orders).`
          : undefined;
  const costError = unitCost.trim() !== '' && !(Number(unitCost) >= 0) ? 'Enter a cost of 0 or more.' : undefined;
  const noteError = (reason === 'Other' || reason === 'other') && !note.trim() ? 'Add a note for “Other”.' : undefined;
  const reasonError = mode === 'count' && !reason.trim() ? 'A reason is required.' : undefined;
  const valid = !qtyError && !noteError && !costError && !reasonError;

  const review = () => {
    setSubmitted(true);
    if (valid) setConfirming(true);
  };

  const summary =
    mode === 'count'
      ? `${ingredient.name}: system ${ingredient.stock} ${unit}, counted ${amount} ${unit} → variance ${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)} ${unit} · ${reason}`
      : `${ingredient.name}: ${ingredient.stock} → ${next} ${unit} (${delta > 0 ? '+' : '−'}${Math.abs(delta)})${
          mode === 'waste' ? ` · Waste: ${WASTE_REASONS.find((r) => r.value === reason)?.label ?? reason}` : reason ? ` · ${reason}` : ''
        }${supplier.trim() ? ` · Supplier: ${supplier.trim()}` : ''}${unitCost.trim() ? ` · ₱${unitCost.trim()}/${unit}` : ''}${note.trim() ? ` · ${note.trim()}` : ''}`;

  return (
    <>
      <Modal
        open={!confirming}
        onClose={onClose}
        title={`${TITLES[mode]} · ${ingredient.name}`}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={review}>
              Review
            </Button>
          </>
        }
      >
        <div className="ing-stock">
          <Tabs
            items={[
              { value: 'restock', label: 'Receive' },
              { value: 'waste', label: 'Waste' },
              { value: 'count', label: 'Count' },
              { value: 'adjust', label: 'Adjust' },
            ]}
            value={mode}
            onChange={(v) => setMode(v as StockMode)}
          />
          {mode === 'adjust' && (
            <div className="field">
              <span className="field__label">Direction</span>
              <Tabs
                variant="chips"
                items={[
                  { value: 'decrease', label: '− Decrease' },
                  { value: 'increase', label: '+ Increase' },
                ]}
                value={direction}
                onChange={(v) => setDirection(v as typeof direction)}
              />
            </div>
          )}
          <div className="ing-stock__row">
            <Input
              label={`${mode === 'restock' ? 'Quantity Received' : mode === 'count' ? 'Counted Quantity' : mode === 'waste' ? 'Quantity Wasted' : 'Adjustment Quantity'} (${unit})`}
              type="number"
              min={0}
              step="any"
              placeholder="0"
              value={qty}
              error={submitted ? qtyError : undefined}
              onChange={(e) => setQty(e.target.value)}
              autoFocus
            />
            {mode === 'adjust' && (
              <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} options={ADJUST_REASONS.map((r) => ({ value: r, label: r }))} />
            )}
            {mode === 'waste' && <Select label="Waste Reason" value={reason} onChange={(e) => setReason(e.target.value)} options={WASTE_REASONS} />}
            {mode === 'count' && (
              <Input label="Reason" value={reason} maxLength={120} error={submitted ? reasonError : undefined} onChange={(e) => setReason(e.target.value)} />
            )}
            {mode === 'restock' && (
              <Input
                label={`Unit Cost (₱ per ${unit}, optional)`}
                type="number"
                min={0}
                step="any"
                value={unitCost}
                error={submitted ? costError : undefined}
                onChange={(e) => setUnitCost(e.target.value)}
              />
            )}
          </div>
          {mode === 'restock' && (
            <>
              <Input label="Supplier (optional)" value={supplier} maxLength={120} onChange={(e) => setSupplier(e.target.value)} />
              {unitCost.trim() !== '' && (
                <Toggle
                  checked={updateCost}
                  onChange={setUpdateCost}
                  label={`Use ₱${unitCost.trim()}/${unit} as the current cost (now ₱${ingredient.cost}/${unit}; past orders keep their cost)`}
                />
              )}
            </>
          )}
          <Input
            label={`Note${noteError ? '' : ' (optional)'}`}
            placeholder={mode === 'restock' ? 'Invoice no., batch…' : 'What happened?'}
            value={note}
            maxLength={120}
            error={submitted ? noteError : undefined}
            onChange={(e) => setNote(e.target.value)}
          />
          {reserved > 0 && (
            <p className="text-muted">
              {reserved} {unit} is reserved for open orders · {roundQty(ingredient.stock - reserved)} {unit} available
            </p>
          )}
          <StockPreview current={ingredient.stock} next={next < 0 ? 0 : next} unit={unit} label={mode === 'count' ? 'Counted' : 'New Stock'} />
        </div>
      </Modal>

      <ConfirmDialog
        open={confirming}
        title={`Confirm ${TITLES[mode].toLowerCase()}?`}
        message={summary}
        confirmLabel="Apply"
        cancelLabel="Back"
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          onApply(ingredient, {
            mode,
            delta,
            reason,
            note: note.trim(),
            unitCost: unitCost.trim() || undefined,
            supplier: supplier.trim() || undefined,
            updateCost: updateCost && unitCost.trim() !== '',
            counted: mode === 'count' ? amount : undefined,
          })
        }
      />
    </>
  );
}
