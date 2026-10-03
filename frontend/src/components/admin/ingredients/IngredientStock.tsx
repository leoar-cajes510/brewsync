import { useEffect, useState } from 'react';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import Input from '../../ui/Input';
import Modal from '../../ui/Modal';
import Select from '../../ui/Select';
import Tabs from '../../ui/Tabs';
import { StockPreview } from '../inventory/inventoryShared';
import { roundQty, type Ingredient } from '../../../types/ingredient';

export type StockMode = 'restock' | 'adjust';

const RESTOCK_REASONS = ['Supplier Delivery', 'Transfer In', 'Other'];
const ADJUST_REASONS = ['Count Correction', 'Spoilage / Expired', 'Damaged', 'Lost', 'Other'];

export interface StockChange {
  mode: StockMode;
  delta: number;
  reason: string;
  note: string;
}

interface IngredientStockProps {
  ingredient: Ingredient | null;
  mode: StockMode;
  onClose: () => void;
  onApply: (ingredient: Ingredient, change: StockChange) => void;
}

// Restock / Adjust Stock for one ingredient. Always shows current → new stock
// and asks for confirmation before applying (applied as a server stock movement).
export default function IngredientStock({ ingredient, mode: initialMode, onClose, onApply }: IngredientStockProps) {
  const [mode, setMode] = useState<StockMode>(initialMode);
  const [direction, setDirection] = useState<'increase' | 'decrease'>('decrease');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!ingredient) return;
    setMode(initialMode);
    setDirection('decrease');
    setQty('');
    setNote('');
    setReason(initialMode === 'restock' ? RESTOCK_REASONS[0] : ADJUST_REASONS[0]);
    setSubmitted(false);
    setConfirming(false);
  }, [ingredient, initialMode]);

  useEffect(() => setReason(mode === 'restock' ? RESTOCK_REASONS[0] : ADJUST_REASONS[0]), [mode]);

  if (!ingredient) return null;

  const amount = qty.trim() === '' ? NaN : Number(qty);
  const sign = mode === 'restock' || direction === 'increase' ? 1 : -1;
  const delta = Number.isFinite(amount) ? roundQty(sign * amount) : 0;
  const next = roundQty(ingredient.stock + delta);
  const qtyError = !(amount > 0)
    ? 'Enter a quantity greater than 0.'
    : next < 0
      ? `Cannot remove more than the ${ingredient.stock} ${ingredient.unit} in stock.`
      : undefined;
  const noteError = reason === 'Other' && !note.trim() ? 'Add a note for “Other”.' : undefined;
  const valid = !qtyError && !noteError;
  const unit = ingredient.unit;

  const review = () => {
    setSubmitted(true);
    if (valid) setConfirming(true);
  };

  return (
    <>
      <Modal
        open={!confirming}
        onClose={onClose}
        title={`${mode === 'restock' ? 'Restock' : 'Adjust Stock'} · ${ingredient.name}`}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={review}>
              Review {mode === 'restock' ? 'Restock' : 'Adjustment'}
            </Button>
          </>
        }
      >
        <div className="ing-stock">
          <Tabs
            items={[
              { value: 'restock', label: 'Restock' },
              { value: 'adjust', label: 'Adjust Stock' },
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
              label={`${mode === 'restock' ? 'Quantity Received' : 'Adjustment Quantity'} (${unit})`}
              type="number"
              min={0}
              step="any"
              placeholder="0"
              value={qty}
              error={submitted ? qtyError : undefined}
              onChange={(e) => setQty(e.target.value)}
              autoFocus
            />
            <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} options={(mode === 'restock' ? RESTOCK_REASONS : ADJUST_REASONS).map((r) => ({ value: r, label: r }))} />
          </div>
          <Input
            label={`Note${reason === 'Other' ? '' : ' (optional)'}`}
            placeholder={mode === 'restock' ? 'Supplier, invoice no., batch…' : 'What happened?'}
            value={note}
            maxLength={120}
            error={submitted ? noteError : undefined}
            onChange={(e) => setNote(e.target.value)}
          />
          <StockPreview current={ingredient.stock} next={next < 0 ? 0 : next} unit={unit} />
        </div>
      </Modal>

      <ConfirmDialog
        open={confirming}
        title={mode === 'restock' ? 'Confirm restock?' : 'Confirm stock adjustment?'}
        message={`${ingredient.name}: ${ingredient.stock} → ${next} ${unit} (${delta > 0 ? '+' : '−'}${Math.abs(delta)}) · Reason: ${reason}${note.trim() ? ` · ${note.trim()}` : ''}`}
        confirmLabel={mode === 'restock' ? 'Apply Restock' : 'Apply Adjustment'}
        cancelLabel="Back"
        onCancel={() => setConfirming(false)}
        onConfirm={() => onApply(ingredient, { mode, delta, reason, note: note.trim() })}
      />
    </>
  );
}
