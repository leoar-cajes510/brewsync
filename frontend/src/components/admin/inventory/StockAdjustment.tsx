import { useState } from 'react';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import Input from '../../ui/Input';
import Modal from '../../ui/Modal';
import Select from '../../ui/Select';
import Tabs from '../../ui/Tabs';
import { StockPreview } from './inventoryShared';
import type { RestockItem } from './RestockModal';
import type { AdjustmentReason } from '../../../stores/catalogStore';

const REASONS: AdjustmentReason[] = ['Count Correction', 'Damaged', 'Lost', 'Other'];
/** Damaged / Lost record a loss, so they only apply to a decrease (the server enforces the same rule). */
const reasonsFor = (direction: 'increase' | 'decrease') => (direction === 'increase' ? REASONS.filter((r) => r !== 'Damaged' && r !== 'Lost') : REASONS);

export interface AdjustmentPreset {
  productId: string;
  direction?: 'increase' | 'decrease';
  reason?: AdjustmentReason;
}

interface StockAdjustmentProps {
  items: RestockItem[];
  preset: AdjustmentPreset;
  onClose: () => void;
  onApply: (productId: string, delta: number, reason: AdjustmentReason, note: string) => void;
}

// Two steps: fill the form (with a live before → after preview), then confirm.
export default function StockAdjustment({ items, preset, onClose, onApply }: StockAdjustmentProps) {
  const [productId, setProductId] = useState(preset.productId);
  const [direction, setDirection] = useState<'increase' | 'decrease'>(preset.direction ?? 'decrease');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<AdjustmentReason>(preset.reason ?? 'Count Correction');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  const item = items.find((i) => i.product.id === productId);
  if (!item) return null;

  const quantity = Number(qty);
  const current = item.product.stock;
  const delta = direction === 'increase' ? quantity : -quantity;
  const qtyError =
    qty === ''
      ? null
      : !Number.isInteger(quantity) || quantity <= 0
        ? 'Enter a whole number greater than 0.'
        : direction === 'decrease' && quantity > current
          ? `Cannot remove more than the ${current} ${item.record.unit} in stock.`
          : null;
  const valid = qty !== '' && !qtyError && (reason !== 'Other' || note.trim().length > 0);
  const next = qty !== '' && !qtyError ? current + delta : current;

  return (
    <>
      <Modal
        open={!confirming}
        onClose={onClose}
        title="Stock Adjustment"
        size="sm"
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!valid} onClick={() => setConfirming(true)}>
              Review Adjustment
            </Button>
          </>
        }
      >
        <div className="adjust-form">
          <Select
            label="Product"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            options={items.map((i) => ({ value: i.product.id, label: `${i.product.name} (#${i.product.code})` }))}
          />
          <div className="field">
            <span className="field__label">Direction</span>
            <Tabs
              items={[
                { value: 'increase', label: 'Increase (+)' },
                { value: 'decrease', label: 'Decrease (−)' },
              ]}
              value={direction}
              onChange={(v) => {
                const next = v as 'increase' | 'decrease';
                setDirection(next);
                if (!reasonsFor(next).includes(reason)) setReason('Count Correction');
              }}
            />
          </div>
          <Input
            label={`Quantity (${item.record.unit})`}
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            placeholder="0"
            value={qty}
            error={qtyError ?? undefined}
            onChange={(e) => setQty(e.target.value)}
          />
          <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value as AdjustmentReason)} options={reasonsFor(direction).map((r) => ({ value: r, label: r }))} />
          <Input
            label={reason === 'Other' ? 'Note (required for Other)' : 'Note (optional)'}
            placeholder="e.g. Recount after closing"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <StockPreview current={current} next={next} unit={item.record.unit} label="Resulting Stock" />
        </div>
      </Modal>

      <ConfirmDialog
        open={confirming}
        danger={direction === 'decrease'}
        title="Apply stock adjustment?"
        message={`${item.product.name}: ${current} → ${current + delta} ${item.record.unit} (${direction === 'increase' ? '+' : '−'}${quantity}) · Reason: ${reason}.`}
        confirmLabel="Apply Adjustment"
        cancelLabel="Back"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          onApply(productId, delta, reason, note.trim());
          onClose();
        }}
      />
    </>
  );
}
