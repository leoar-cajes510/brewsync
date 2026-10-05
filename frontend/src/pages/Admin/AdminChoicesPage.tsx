import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Layers, Link2, ListChecks, Plus, SearchX, SlidersHorizontal } from 'lucide-react';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import EmptyState from '../../components/ui/EmptyState';
import SearchBar from '../../components/ui/SearchBar';
import Select from '../../components/ui/Select';
import ChoiceGroupList from '../../components/admin/choices/ChoiceGroupList';
import ChoiceGroupForm, { newOption } from '../../components/admin/choices/ChoiceGroupForm';
import LoadingState from '../../components/ui/LoadingState';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import type { AdminChoiceGroup, ChoiceGroupDraft } from '../../types/choice';
import type { ChoiceGroupDto, ProductDto } from '../../types/api';
import { errorMessage } from '../../services/api';
import { createChoiceGroup, listChoiceGroups, listProducts, updateChoiceGroup, type ChoiceGroupInput } from '../../services/productService';
import { listIngredients } from '../../services/inventoryService';
import { can, useAuth } from '../../stores/authStore';
import { useFeatureSettings } from '../../stores/featureSettingsStore';
import type { EffectIngredient } from '../../components/admin/choices/ChoiceOptionForm';
import '../../components/admin/products/products.css';
import '../../components/admin/choices/choices.css';

type FilterValue<T extends string> = 'all' | T;

/** Next free MOD-NN code; the server still enforces uniqueness (409 CONFLICT). */
function nextCode(groups: AdminChoiceGroup[]): string {
  const max = groups.reduce((m, g) => Math.max(m, Number(/^MOD-(\d+)$/.exec(g.code)?.[1] ?? 0)), 0);
  return `MOD-${String(max + 1).padStart(2, '0')}`;
}

function fromDto(g: ChoiceGroupDto): AdminChoiceGroup {
  return {
    id: g.id,
    code: g.code,
    name: g.name,
    displayName: g.display_name ?? '',
    description: g.description ?? '',
    type: g.selection_type,
    required: g.required,
    min: g.min_select,
    max: g.max_select,
    active: g.active ?? true,
    options: g.options.map((o) => ({
      id: o.id,
      name: o.name,
      price: Number(o.price_delta),
      active: o.active ?? true,
      isDefault: o.is_default ?? false,
      effects: (o.effects ?? []).map((e) => ({ mode: e.mode, ingredientId: e.ingredient_id ?? '', replacesId: e.replaces_ingredient_id ?? '', quantity: String(Number(e.quantity)) })),
      effectWarnings: o.effect_warnings ?? [],
    })),
  };
}

/** Existing options keep their server id; options created in the form (client ids) are sent without one.
 * Effects are sent only when the user may edit them — otherwise the key is omitted so stored effects stay. */
function toInput(draft: ChoiceGroupDraft, existing: AdminChoiceGroup | null, withEffects: boolean): ChoiceGroupInput {
  const known = new Set(existing?.options.map((o) => o.id) ?? []);
  return {
    name: draft.name,
    display_name: draft.displayName,
    description: draft.description,
    selection_type: draft.type,
    required: draft.required,
    min_select: draft.min,
    max_select: draft.max,
    options: draft.options.map((o) => ({
      ...(known.has(o.id) ? { id: o.id } : {}),
      name: o.name,
      price_delta: o.price.toFixed(2),
      is_default: o.isDefault,
      active: o.active,
      ...(withEffects
        ? {
            effects: o.effects.map((e) => ({
              mode: e.mode,
              ingredient_id: e.mode === 'scale' ? null : e.ingredientId,
              replaces_ingredient_id: e.mode === 'replace' ? e.replacesId : null,
              quantity: e.quantity,
            })),
          }
        : {}),
    })),
  };
}

// Reusable customization groups (GET/POST/PATCH /choice-groups). Groups and options are never
// deleted — past orders reference them (Q-DEL-1) — so "remove" means deactivate.
export default function AdminChoicesPage() {
  const [groups, setGroups] = useState<AdminChoiceGroup[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<FilterValue<'single' | 'multi'>>('all');
  const [requirement, setRequirement] = useState<FilterValue<'required' | 'optional'>>('all');
  const [status, setStatus] = useState<FilterValue<'active' | 'inactive'>>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminChoiceGroup | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const editing = groups.find((g) => g.id === editingId) ?? null;
  const { user } = useAuth();
  const { flags } = useFeatureSettings();
  const canEditEffects = can(user, 'ingredients.recipes') && flags.ingredients;
  const [ingredients, setIngredients] = useState<EffectIngredient[] | undefined>(undefined);

  useEffect(() => {
    if (!canEditEffects) {
      setIngredients(undefined);
      return;
    }
    let live = true;
    listIngredients()
      .then((list) => live && setIngredients(list.map((i) => ({ id: i.id, name: i.name, unit: i.unit, active: i.active }))))
      .catch(() => live && setIngredients(undefined)); // without the list, effects stay read-only (key omitted)
    return () => {
      live = false;
    };
  }, [canEditEffects]);
  const withEffects = canEditEffects && ingredients !== undefined;

  const refresh = useCallback(async () => {
    try {
      const [list, prods] = await Promise.all([listChoiceGroups(), listProducts()]);
      setGroups(list.map(fromDto));
      setProducts(prods);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const linkedProducts = useMemo(() => products.filter((p) => p.choice_group_ids.length > 0).length, [products]);

  const counts = useMemo(() => {
    const options = groups.flatMap((g) => g.options);
    return {
      total: groups.length,
      active: groups.filter((g) => g.active).length,
      required: groups.filter((g) => g.required).length,
      options: options.length,
      activeOptions: options.filter((o) => o.active).length,
      paid: options.filter((o) => o.price > 0).length,
    };
  }, [groups]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups.filter(
      (g) =>
        (type === 'all' || g.type === type) &&
        (requirement === 'all' || (requirement === 'required') === g.required) &&
        (status === 'all' || (status === 'active') === g.active) &&
        (!q ||
          g.name.toLowerCase().includes(q) ||
          g.code.toLowerCase().includes(q) ||
          g.options.some((o) => o.name.toLowerCase().includes(q))),
    );
  }, [groups, query, type, requirement, status]);

  const openAdd = () => {
    setEditingId(null);
    setFormOpen(true);
  };
  const openEdit = (g: AdminChoiceGroup) => {
    setEditingId(g.id);
    setFormOpen(true);
  };
  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
  };

  const run = async (action: () => Promise<unknown>, message: string, close = true) => {
    setSaving(true);
    try {
      await action();
      await refresh();
      if (close) closeForm();
      setFeedback(message);
    } catch (err) {
      setFeedback(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const save = (draft: ChoiceGroupDraft) => {
    if (saving) return;
    if (editing) {
      void run(() => updateChoiceGroup(editing.id, { ...toInput(draft, editing, withEffects), active: draft.active }), `${draft.name} updated`);
    } else {
      void run(async () => {
        const created = await createChoiceGroup({ ...toInput(draft, null, withEffects), code: nextCode(groups) });
        if (!draft.active) await updateChoiceGroup(created.id, { active: false });
      }, `${draft.name} created`);
    }
  };

  const duplicate = (source: AdminChoiceGroup) => {
    if (saving) return;
    const copy = { ...source, name: `${source.name} (Copy)`, options: source.options.map((o) => ({ ...o, id: newOption().id })) };
    void run(() => createChoiceGroup({ ...toInput(copy, null, withEffects), code: nextCode(groups) }), `Duplicated as ${copy.name}`);
  };

  const toggleActive = (g: AdminChoiceGroup) => {
    if (saving) return;
    void run(() => updateChoiceGroup(g.id, { active: !g.active }), `${g.name} ${g.active ? 'deactivated' : 'activated'}`, false);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    if (target.active) toggleActive(target);
    else setFeedback(`${target.name} is already inactive`);
  };

  const kpis = [
    { key: 'total', label: 'Total Choice Groups', value: String(counts.total), sub: `${counts.active} active`, icon: Layers, tone: '' },
    { key: 'required', label: 'Required Groups', value: String(counts.required), sub: 'Mandatory at POS checkout', icon: AlertCircle, tone: 'warning' },
    { key: 'options', label: 'Active Options', value: String(counts.activeOptions), sub: `${counts.paid} priced · ${counts.options - counts.paid} free`, icon: ListChecks, tone: '' },
    { key: 'linked', label: 'Linked Products', value: String(linkedProducts), sub: 'Products using a choice group', icon: Link2, tone: 'accent' },
  ];

  const hasFilters = query || type !== 'all' || requirement !== 'all' || status !== 'all';

  return (
    <div className="admin-choices">
      <section className="choice-kpis" aria-label="Choices summary">
        {kpis.map(({ key, label, value, sub, icon: Icon, tone }) => (
          <article key={key} className={`choice-kpi ${tone ? `choice-kpi--${tone}` : ''}`}>
            <div>
              <span className="choice-kpi__label">{label}</span>
              <strong className="choice-kpi__value">{value}</strong>
              <p>{sub}</p>
            </div>
            <span className="choice-kpi__icon">
              <Icon size={18} />
            </span>
          </article>
        ))}
      </section>

      <section className="choice-toolbar">
        <SearchBar
          className="choice-toolbar__search"
          placeholder="Search groups or options…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search choice groups"
        />
        <Select
          className="choice-toolbar__select"
          aria-label="Filter by type"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          options={[
            { value: 'all', label: 'Type: All Types' },
            { value: 'single', label: 'Type: Single Select' },
            { value: 'multi', label: 'Type: Multi Select' },
          ]}
        />
        <Select
          className="choice-toolbar__select"
          aria-label="Filter by requirement"
          value={requirement}
          onChange={(e) => setRequirement(e.target.value as typeof requirement)}
          options={[
            { value: 'all', label: 'Requirement: All' },
            { value: 'required', label: 'Requirement: Required' },
            { value: 'optional', label: 'Requirement: Optional' },
          ]}
        />
        <Select
          className="choice-toolbar__select choice-toolbar__select--status"
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          options={[
            { value: 'all', label: `Status: All (${counts.total})` },
            { value: 'active', label: `Active (${counts.active})` },
            { value: 'inactive', label: `Inactive (${counts.total - counts.active})` },
          ]}
        />
        <div className="choice-toolbar__actions">
          <Button icon={<SlidersHorizontal size={15} />} disabled title="Reordering comes in a later phase">
            Reorder Groups
          </Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={openAdd}>
            Add Choice Group
          </Button>
        </div>
      </section>

      {loading ? (
        <LoadingState label="Loading choice groups…" />
      ) : loadError ? (
        <div className="choice-empty">
          <EmptyState title="Could not load choice groups" description={loadError} action={<Button onClick={() => void refresh()}>Try again</Button>} />
        </div>
      ) : groups.length === 0 ? (
        <div className="choice-empty">
          <EmptyState
            icon={<Layers size={22} />}
            title="No choice groups yet"
            description="Create reusable customization options that can be attached to your menu items."
            action={
              <Button variant="primary" icon={<Plus size={16} />} onClick={openAdd}>
                Add Choice Group
              </Button>
            }
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="choice-empty">
          <EmptyState
            icon={<SearchX size={22} />}
            title="No choice groups match"
            description="Try a different search, type, requirement, or status."
            action={
              hasFilters && (
                <Button
                  onClick={() => {
                    setQuery('');
                    setType('all');
                    setRequirement('all');
                    setStatus('all');
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        </div>
      ) : (
        <ChoiceGroupList
          groups={visible}
          selectedId={formOpen ? editingId : null}
          onEdit={openEdit}
          onDuplicate={duplicate}
          onToggleActive={toggleActive}
          onDelete={setDeleting}
        />
      )}

      <ChoiceGroupForm
        open={formOpen}
        group={editing}
        onClose={closeForm}
        onSave={save}
        onDuplicate={duplicate}
        onToggleActive={toggleActive}
        ingredients={withEffects ? ingredients : undefined}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Deactivate choice group?"
        message={deleting && `Choice groups cannot be deleted because past orders reference them. “${deleting.name}” will be deactivated and hidden from the POS; you can activate it again later.`}
        confirmLabel="Deactivate Group"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />

      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}
