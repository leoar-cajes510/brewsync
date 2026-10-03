import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Modal from '../../ui/Modal';
import Toggle from '../../ui/Toggle';
import { errorMessage } from '../../../services/api';
import { CODE_PREFIX_PATTERN } from '../../../services/productService';
import type { CategoryDto } from '../../../types/api';

interface CategoryManagerProps {
  open: boolean;
  categories: CategoryDto[];
  onClose: () => void;
  onCreate: (name: string, codePrefix: string) => Promise<void>;
  onUpdate: (id: string, patch: { name?: string; active?: boolean }) => Promise<void>;
}

// Categories (GET/POST/PATCH /categories). Categories are never deleted — products and past
// orders reference them — so an unused one is deactivated (hidden from the POS) instead.
export default function CategoryManager({ open, categories, onClose, onCreate, onUpdate }: CategoryManagerProps) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [newPrefix, setNewPrefix] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNames(Object.fromEntries(categories.map((c) => [c.id, c.name])));
      setError(null);
    }
  }, [open, categories]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const prefix = newPrefix.trim();
  const prefixError = !prefix
    ? null
    : !CODE_PREFIX_PATTERN.test(prefix)
      ? 'Prefix: 2–5 letters or numbers, starting with a letter.'
      : categories.some((c) => c.code_prefix === prefix)
        ? `Prefix ${prefix} is already used by another category.`
        : null;

  return (
    <Modal open={open} onClose={onClose} title="Categories" size="sm" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="category-manager">
        {categories.length === 0 && <p className="field__hint">No categories yet. Add one below or while creating a product.</p>}
        {categories.map((c) => {
          const name = names[c.id] ?? c.name;
          const renamed = name.trim() !== c.name;
          return (
            <div key={c.id} className="category-manager__row">
              <span className="category-manager__prefix" title="Code prefix (fixed)">{c.code_prefix}</span>
              <Input aria-label={`Category name ${c.name}`} value={name} maxLength={80} onChange={(e) => setNames((n) => ({ ...n, [c.id]: e.target.value }))} />
              <Button size="sm" disabled={!renamed || busy || !name.trim()} onClick={() => void run(() => onUpdate(c.id, { name: name.trim() }))}>
                Rename
              </Button>
              <Toggle checked={c.active} onChange={(v) => void run(() => onUpdate(c.id, { active: v }))} label={c.active ? 'Active' : 'Inactive'} />
            </div>
          );
        })}
        <div className="category-manager__row category-manager__add">
          <Input aria-label="New category name" placeholder="New category name" value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} />
          <Input
            aria-label="Code prefix"
            className="category-manager__prefix-input"
            placeholder="Prefix, e.g. COF"
            value={newPrefix}
            maxLength={5}
            onChange={(e) => setNewPrefix(e.target.value.toUpperCase())}
          />
          <Button
            size="sm"
            variant="primary"
            icon={<Plus size={14} />}
            disabled={!newName.trim() || !prefix || prefixError !== null || busy}
            onClick={() =>
              void run(async () => {
                await onCreate(newName.trim(), prefix);
                setNewName('');
                setNewPrefix('');
              })
            }
          >
            Add
          </Button>
        </div>
        <p className="field__hint">The prefix is used for automatic product codes (e.g. COF-001) and can't be changed later.</p>
        {prefixError && <span className="field__error">{prefixError}</span>}
        {error && (
          <div className="api-status api-status--error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
