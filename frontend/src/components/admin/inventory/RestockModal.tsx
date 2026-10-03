import { useState } from 'react';
import { Minus, PackagePlus, Plus } from 'lucide-react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Modal from '../../ui/Modal';
import Select from '../../ui/Select';
import { STOCK_UNITS, StockPreview } from './inventoryShared';
import type { InventoryRecord } from '../../../types/inventory';
import type { CatalogProduct } from '../../../types/product';

export interface RestockItem {
  product: CatalogProduct;
  record: InventoryRecord;
}

interface RestockFormProps {
  items: RestockItem[];
  productId: string;
  /** Hide the product picker (panel already shows the product). */
  lockProduct?: boolean;
  onProductChange?: (id: string) => void;
  onConfirm: (productId: string, quantity: number, unit: string, note: string) => void;
  onCancel?: () => void;
  compact?: boolean;
}

/** Restock form body; used inline in the Quick Restock panel and inside RestockModal. */
export function RestockForm({ items, productId, lockProduct, onProductChange, onConfirm, onCancel, compact }: RestockFormProps) {
  const item = items.find((i) => i.product.id === productId);
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState(item?.record.unit ?? STOCK_UNITS[0]);
  const [note, setNote] = useState('');

  if (!item) return null;
  const quantity = Number(qty);
  const valid = Number.isInteger(quantity) && quantity > 0;
  const step = (d: number) => setQty(String(Math.max(0, (Number.isFinite(quantity) ? quantity : 0) + d)));

  const submit = () => {
    if (!valid) return;
    onConfirm(productId, quantity, unit, note.trim());
    setQty('');
    setNote('');
  };

  return (
    <div className={`restock-form ${compact ? 'restock-form--compact' : ''}`}>
      {!lockProduct && (
        <Select
          label="Product"
          value={productId}
          onChange={(e) => {
            onProductChange?.(e.target.value);
            const next = items.find((i) => i.product.id === e.target.value);
            if (next) setUnit(next.record.unit);
          }}
          options={items.map((i) => ({ value: i.product.id, label: `${i.product.name} (#${i.product.code})` }))}
        />
      )}

      <StockPreview current={item.product.stock} next={item.product.stock + (valid ? quantity : 0)} unit={unit} label="Projected New Stock" />

      <div className="restock-form__qty">
        <span className="field__label">Quantity to Add (+)</span>
        <div className="qty-stepper">
          <button type="button" aria-label="Decrease quantity" onClick={() => step(-1)}>
            <Minus size={16} />
          </button>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            aria-label="Quantity to add"
            placeholder="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <button type="button" className="qty-stepper__plus" aria-label="Increase quantity" onClick={() => step(1)}>
            <Plus size={16} />
          </button>
        </div>
        {qty !== '' && !valid && <span className="field__error">Enter a whole number greater than 0.</span>}
      </div>

      {/* Product stock is counted in the product's own unit; the server takes the quantity in that unit. */}
      <Input label="Unit" value={unit} readOnly disabled />
      <Input label="Delivery / Restock Note (optional)" placeholder="e.g. Morning delivery batch #B-402" value={note} onChange={(e) => setNote(e.target.value)} />

      <div className="restock-form__actions">
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        <Button variant="primary" size={compact ? 'lg' : 'md'} block={compact} icon={<PackagePlus size={17} />} disabled={!valid} onClick={submit}>
          Confirm Restock{valid ? ` (+${quantity})` : ''}
        </Button>
      </div>
    </div>
  );
}

interface RestockModalProps {
  open: boolean;
  items: RestockItem[];
  initialProductId: string | null;
  onClose: () => void;
  onConfirm: (productId: string, quantity: number, unit: string, note: string) => void;
}

export default function RestockModal({ open, items, initialProductId, onClose, onConfirm }: RestockModalProps) {
  const [productId, setProductId] = useState(initialProductId ?? items[0]?.product.id ?? '');
  if (!open || items.length === 0) return null;
  return (
    <Modal open onClose={onClose} title="Restock Product" size="sm">
      <RestockForm
        key={productId}
        items={items}
        productId={productId}
        onProductChange={setProductId}
        onCancel={onClose}
        onConfirm={(...args) => {
          onConfirm(...args);
          onClose();
        }}
      />
    </Modal>
  );
}
