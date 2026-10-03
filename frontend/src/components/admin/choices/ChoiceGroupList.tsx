import { Archive, Copy, GripVertical, Pencil, Power } from 'lucide-react';
import Badge from '../../ui/Badge';
import { formatPeso } from '../../../utils/currency';
import { SELECTION_TYPE_LABEL, selectionRule, type AdminChoiceGroup } from '../../../types/choice';

interface ChoiceGroupListProps {
  groups: AdminChoiceGroup[];
  selectedId: string | null;
  onEdit: (group: AdminChoiceGroup) => void;
  onDuplicate: (group: AdminChoiceGroup) => void;
  onToggleActive: (group: AdminChoiceGroup) => void;
  onDelete: (group: AdminChoiceGroup) => void;
}

export default function ChoiceGroupList({ groups, selectedId, onEdit, onDuplicate, onToggleActive, onDelete }: ChoiceGroupListProps) {
  return (
    <ul className="choice-list">
      {groups.map((g) => {
        const activeOptions = g.options.filter((o) => o.active).length;
        return (
          <li
            key={g.id}
            className={`choice-card ${g.id === selectedId ? 'choice-card--selected' : ''} ${g.active ? '' : 'choice-card--inactive'}`}
          >
            <GripVertical size={16} className="choice-card__grip" aria-hidden />
            <div className="choice-card__body">
              <div className="choice-card__title">
                <strong>{g.name}</strong>
                <span className="code-chip">#{g.code}</span>
                <span className={`choice-tag choice-tag--${g.type}`}>
                  {SELECTION_TYPE_LABEL[g.type]} ({g.type === 'single' ? 'Radio' : 'Checkbox'})
                </span>
                <span className={`choice-tag ${g.required ? 'choice-tag--required' : ''}`}>
                  {g.required ? 'Required' : 'Optional'} · {selectionRule(g)}
                </span>
                <Badge tone={g.active ? 'success' : 'neutral'} dot>
                  {g.active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              {(g.displayName || g.description) && (
                <p className="choice-card__desc">
                  {g.displayName && <span className="choice-card__display">“{g.displayName}”</span>}
                  {g.displayName && g.description && ' · '}
                  {g.description}
                </p>
              )}
              <div className="choice-card__options">
                {g.options.map((o) => (
                  <span
                    key={o.id}
                    className={`choice-chip ${o.isDefault ? 'choice-chip--default' : ''} ${o.active ? '' : 'choice-chip--inactive'}`}
                    title={o.active ? undefined : 'Inactive option'}
                  >
                    {o.name}
                    {o.isDefault && <em>Default</em>}
                    <span className="choice-chip__price">+{formatPeso(o.price)}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="choice-card__side">
              <div className="choice-card__count">
                <strong>
                  {activeOptions}/{g.options.length} Options
                </strong>
                <span>Not linked to products yet</span>
              </div>
              <div className="choice-card__actions">
                <button type="button" className="icon-btn" aria-label={`Edit ${g.name}`} title="Edit" onClick={() => onEdit(g)}>
                  <Pencil size={15} />
                </button>
                <button type="button" className="icon-btn" aria-label={`Duplicate ${g.name}`} title="Duplicate" onClick={() => onDuplicate(g)}>
                  <Copy size={15} />
                </button>
                <button
                  type="button"
                  className={`icon-btn ${g.active ? '' : 'choice-card__power--off'}`}
                  aria-label={`${g.active ? 'Deactivate' : 'Activate'} ${g.name}`}
                  title={g.active ? 'Deactivate' : 'Activate'}
                  onClick={() => onToggleActive(g)}
                >
                  <Power size={15} />
                </button>
                {g.active && (
                  // Choice groups are never deleted (past orders reference them, Q-DEL-1): this deactivates.
                  <button type="button" className="icon-btn choice-card__delete" aria-label={`Deactivate ${g.name}`} title="Deactivate" onClick={() => onDelete(g)}>
                    <Archive size={15} />
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
