import { Percent, Tag } from 'lucide-react';
import Modal from '../ui/Modal';

export interface DiscountOption {
  id: string;
  label: string;
  description: string;
}

interface DiscountSelectorProps {
  open: boolean;
  options: DiscountOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export default function DiscountSelector({ open, options, selectedId, onSelect, onClose }: DiscountSelectorProps) {
  return (
    <Modal open={open} onClose={onClose} title="Apply Discount" size="sm">
      <div className="option-list">
        {options.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`option-tile ${d.id === selectedId ? 'option-tile--active' : ''}`}
            onClick={() => onSelect(d.id)}
          >
            <span className="option-tile__icon">{d.id.includes('less') ? <Tag size={16} /> : <Percent size={16} />}</span>
            <span className="option-tile__text">
              <strong>{d.label}</strong>
              <span>{d.description}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
