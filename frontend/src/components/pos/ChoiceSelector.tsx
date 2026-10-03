import { useState } from 'react';
import { Check } from 'lucide-react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import type { ChoiceGroup, Product } from '../../types/product';
import type { SelectedChoice } from '../../types/order';
import { formatPeso } from '../../utils/currency';

interface ChoiceSelectorProps {
  product: Product | null;
  onClose: () => void;
  onConfirm: (product: Product, choices: SelectedChoice[]) => void;
}

// Allowed selection count per group — the same rule the server applies (R2.3).
export function selectionBounds(g: ChoiceGroup): [number, number] {
  if (g.mode === 'single') return g.required ? [1, 1] : [0, 1];
  const max = g.maxSelect ?? g.options.length;
  const min = g.minSelect ?? 0;
  return [g.required ? Math.max(1, min) : min, max];
}

function groupHint(g: ChoiceGroup): string {
  const [low, high] = selectionBounds(g);
  if (g.mode === 'single') return low ? 'Required · pick one' : 'Optional · pick one';
  if (low === 0) return `Optional · up to ${high}`;
  return `${g.required ? 'Required' : 'Pick'} · ${low === high ? low : `${low}–${high}`}`;
}

// Start from the Admin's default options only; nothing is picked on the cashier's behalf.
function defaultSelection(product: Product): Record<string, string[]> {
  return Object.fromEntries(
    product.choiceGroups.map((g) => {
      const defaults = g.options.filter((o) => o.isDefault).map((o) => o.id);
      return [g.id, defaults.slice(0, selectionBounds(g)[1])];
    }),
  );
}

function ChoiceSelectorBody({ product, onClose, onConfirm }: ChoiceSelectorProps & { product: Product }) {
  const [selected, setSelected] = useState<Record<string, string[]>>(() => defaultSelection(product));

  const toggle = (group: ChoiceGroup, optionId: string) => {
    setSelected((prev) => {
      const current = prev[group.id] ?? [];
      const on = current.includes(optionId);
      if (group.mode === 'single') return { ...prev, [group.id]: on && !group.required ? [] : [optionId] };
      if (on) return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
      if (current.length >= selectionBounds(group)[1]) return prev; // at the maximum
      return { ...prev, [group.id]: [...current, optionId] };
    });
  };

  const missing = product.choiceGroups.filter((g) => (selected[g.id]?.length ?? 0) < selectionBounds(g)[0]);

  const choices: SelectedChoice[] = product.choiceGroups.flatMap((g) =>
    g.options.filter((o) => selected[g.id]?.includes(o.id)).map((o) => ({ ...o, groupId: g.id })),
  );
  const unitPrice = product.price + choices.reduce((sum, c) => sum + c.priceDelta, 0);

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={product.name}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={missing.length > 0} title={missing.length ? `Choose ${missing.map((g) => g.name).join(', ')}` : undefined} onClick={() => onConfirm(product, choices)}>
            {missing.length ? `Choose ${missing[0].name}` : `Add to Order · ${formatPeso(unitPrice)}`}
          </Button>
        </>
      }
    >
      <div className="choice-selector">
        {product.choiceGroups.map((group) => (
          <section key={group.id} className="choice-group">
            <div className="choice-group__header">
              <h4>{group.name}</h4>
              <span>{groupHint(group)}</span>
            </div>
            <div className="choice-group__options">
              {group.options.map((option) => {
                const active = selected[group.id]?.includes(option.id) ?? false;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`choice-option ${active ? 'choice-option--active' : ''}`}
                    aria-pressed={active}
                    onClick={() => toggle(group, option.id)}
                  >
                    <span className="choice-option__check">{active && <Check size={12} />}</span>
                    <span className="choice-option__label">{option.label}</span>
                    {option.priceDelta > 0 && <span className="choice-option__price">+{formatPeso(option.priceDelta)}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}

// Keyed by product so each open starts from that product's defaults.
export default function ChoiceSelector({ product, onClose, onConfirm }: ChoiceSelectorProps) {
  if (!product) return null;
  return <ChoiceSelectorBody key={product.id} product={product} onClose={onClose} onConfirm={onConfirm} />;
}
