import { useId, useState } from 'react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Modal from '../../ui/Modal';
import Select from '../../ui/Select';
import Toggle from '../../ui/Toggle';
import { errorMessage } from '../../../services/api';
import { CODE_PREFIX_PATTERN } from '../../../services/productService';
import ProductImageUpload from './ProductImageUpload';
import type { CatalogProduct, CatalogProductDraft } from '../../../types/product';

interface ProductFormProps {
  /** Existing product when editing; omit for Add Product. */
  product?: CatalogProduct;
  /** All server categories (inactive ones are not offered, but their prefixes stay reserved). */
  categories: { name: string; codePrefix: string; active: boolean }[];
  /** Choice groups from Admin → Choices (inactive ones are shown only if already linked). */
  choiceGroups: { id: string; name: string; active: boolean }[];
  onCancel: () => void;
  /** Saves to the server; a rejection is shown inside the form. */
  onSubmit: (draft: CatalogProductDraft) => Promise<void>;
}

interface FormState {
  name: string;
  category: string;
  price: string;
  stock: string;
  description: string;
  image: string | null;
  available: boolean;
  /** Only for a category typed as new; existing categories keep their stored prefix. */
  categoryPrefix: string;
  taxClass: '' | 'taxable' | 'non_taxable';
  trackUnits: boolean;
  threshold: string;
  choiceGroupIds: string[];
}

type Errors = Partial<Record<keyof FormState, string>>;

function validate(f: FormState, isEdit: boolean, newCategory: boolean, takenPrefixes: string[]): Errors {
  const errors: Errors = {};
  if (!f.name.trim()) errors.name = 'Product name is required.';
  if (!f.category.trim()) errors.category = 'Category is required.';
  const price = Number(f.price);
  if (f.price.trim() === '' || !Number.isFinite(price) || price <= 0) errors.price = 'Enter a price greater than 0.';
  if (!f.taxClass) errors.taxClass = 'Choose whether this product is taxable.';
  if (!isEdit && f.trackUnits) {
    const stock = Number(f.stock);
    if (f.stock.trim() === '' || !Number.isInteger(stock) || stock < 0) errors.stock = 'Enter a whole number, 0 or more.';
    const threshold = Number(f.threshold);
    if (f.threshold.trim() === '' || !Number.isInteger(threshold) || threshold < 0) errors.threshold = 'Enter a whole number, 0 or more.';
  }
  if (newCategory) {
    const prefix = f.categoryPrefix.trim().toUpperCase();
    if (!prefix) errors.categoryPrefix = 'Code prefix is required for a new category.';
    else if (!CODE_PREFIX_PATTERN.test(prefix)) errors.categoryPrefix = '2–5 letters or numbers, starting with a letter.';
    else if (takenPrefixes.includes(prefix)) errors.categoryPrefix = 'This prefix is already used by another category.';
  }
  return errors;
}

// Add / Edit product, saved through the products API. Price and taxability are the
// owner's choice (no tax default is assumed); the server validates everything again.
export default function ProductForm({ product, categories, choiceGroups, onCancel, onSubmit }: ProductFormProps) {
  const isEdit = Boolean(product);
  const listId = useId();
  const [form, setForm] = useState<FormState>(() => ({
    name: product?.name ?? '',
    category: product?.category ?? '',
    price: product ? String(product.price) : '',
    stock: product ? String(product.stock) : '',
    description: product?.description ?? '',
    image: product?.image ?? null,
    available: product?.available ?? true,
    categoryPrefix: '',
    taxClass: product?.taxClass ?? '',
    trackUnits: product?.trackUnits ?? true,
    threshold: '',
    choiceGroupIds: product?.choiceGroupIds ?? [],
  }));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const existingCategories = categories.filter((c) => c.active).map((c) => c.name).sort((a, b) => a.localeCompare(b));
  const typed = form.category.trim();
  const chosen = categories.find((c) => c.name === typed) ?? categories.find((c) => c.name.toLowerCase() === typed.toLowerCase());
  const newCategory = form.category.trim() !== '' && !chosen;
  const errors = validate(form, isEdit, newCategory, categories.map((c) => c.codePrefix));
  const previewPrefix = chosen?.codePrefix ?? (form.categoryPrefix.trim().toUpperCase() || 'PREFIX');
  const show = (key: keyof FormState) => (touched ? errors[key] : undefined);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    setTouched(true);
    if (Object.keys(errors).length > 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSubmit({
        name: form.name.trim(),
        category: form.category.trim(),
        price: Math.round(Number(form.price) * 100) / 100,
        stock: isEdit ? product!.stock : form.trackUnits ? Number(form.stock) : 0,
        lowStockThreshold: !isEdit && form.trackUnits ? Number(form.threshold) : undefined,
        description: form.description.trim(),
        image: form.image,
        available: form.available,
        active: product?.active ?? true,
        code: product?.code ?? '',
        categoryPrefix: newCategory ? form.categoryPrefix.trim().toUpperCase() : undefined,
        taxClass: form.taxClass,
        trackUnits: isEdit ? product!.trackUnits : form.trackUnits,
        choiceGroupIds: form.choiceGroupIds,
      });
    } catch (err) {
      setSaveError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onCancel}
      size="lg"
      title={isEdit ? `Edit Product · ${product!.name}` : 'Add Product'}
      footer={
        <>
          <Button onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Product'}
          </Button>
        </>
      }
    >
      <form
        className="product-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="product-form__media">
          <ProductImageUpload value={form.image} onChange={(img) => set('image', img)} />
          <p className="product-form__hint">Image storage is not connected yet (open decision Q-ARCH-2); the preview is not saved.</p>
        </div>

        <div className="product-form__fields">
          <Input
            className="product-form__wide"
            label="Product Name"
            placeholder="e.g. Spanish Latte"
            value={form.name}
            error={show('name')}
            onChange={(e) => set('name', e.target.value)}
            autoFocus
          />
          <div className="field">
            <label className="field__label" htmlFor={`${listId}-category`}>
              Category
            </label>
            <input
              id={`${listId}-category`}
              className={`input ${show('category') ? 'input--error' : ''}`}
              list={listId}
              placeholder={existingCategories.length ? 'Choose or type a category' : 'Type a new category'}
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
            />
            <datalist id={listId}>
              {existingCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {show('category') ? <span className="field__error">{show('category')}</span> : <span className="field__hint">New categories are created as you type.</span>}
          </div>
          {newCategory && (
            <Input
              label="Code Prefix (new category)"
              placeholder="e.g. COF"
              maxLength={5}
              value={form.categoryPrefix}
              error={show('categoryPrefix')}
              hint="Used for automatic product codes (e.g. COF-001). Can't be changed later."
              onChange={(e) => set('categoryPrefix', e.target.value.toUpperCase())}
            />
          )}
          <div className="field">
            <span className="field__label">Product Code</span>
            <div className="product-form__readonly">{isEdit ? product!.code : 'Auto-generated on save'}</div>
            <span className="field__hint">
              {isEdit
                ? 'Codes never change, even if the product moves to another category.'
                : `Example: ${previewPrefix}-### (next number in the category).`}
            </span>
          </div>
          <Input
            label="Price (₱)"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            value={form.price}
            error={show('price')}
            onChange={(e) => set('price', e.target.value)}
          />
          <div className="field">
            <Select
              label="Taxability"
              placeholder="Choose…"
              value={form.taxClass}
              onChange={(e) => set('taxClass', e.target.value as FormState['taxClass'])}
              options={[
                { value: 'taxable', label: 'Taxable' },
                { value: 'non_taxable', label: 'Non-taxable' },
              ]}
            />
            {show('taxClass') && <span className="field__error">{show('taxClass')}</span>}
          </div>
          {isEdit ? (
            <div className="field">
              <span className="field__label">Stock</span>
              <div className="product-form__readonly">{product!.trackUnits ? `${product!.stock} in stock` : 'Not tracked'}</div>
              <span className="field__hint">Stock adjustments are made in Admin → Inventory.</span>
            </div>
          ) : (
            <div className="field">
              <span className="field__label">Stock Tracking</span>
              <div className="product-form__toggle">
                <Toggle checked={form.trackUnits} onChange={(v) => set('trackUnits', v)} label={form.trackUnits ? 'Track unit stock' : 'Not tracked'} />
              </div>
            </div>
          )}
          {!isEdit && form.trackUnits && (
            <>
              <Input
                label="Initial Stock"
                type="number"
                min={0}
                step="1"
                inputMode="numeric"
                placeholder="0"
                value={form.stock}
                error={show('stock')}
                hint="Starting quantity. Later changes happen in Inventory."
                onChange={(e) => set('stock', e.target.value)}
              />
              <Input
                label="Low-Stock Threshold"
                type="number"
                min={0}
                step="1"
                inputMode="numeric"
                value={form.threshold}
                error={show('threshold')}
                hint="Alert when available stock reaches this level."
                onChange={(e) => set('threshold', e.target.value)}
              />
            </>
          )}
          <div className="field product-form__wide">
            <label className="field__label" htmlFor={`${listId}-desc`}>
              Description
            </label>
            <textarea
              id={`${listId}-desc`}
              className="input product-form__textarea"
              rows={3}
              maxLength={160}
              placeholder="Short description shown under the product name"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
            <span className="field__hint">{form.description.length}/160</span>
          </div>
          <div className="field product-form__wide">
            <span className="field__label">Availability</span>
            <div className="product-form__toggle">
              <Toggle checked={form.available} onChange={(v) => set('available', v)} label={form.available ? 'Available — shown on the POS menu' : 'Unavailable — hidden from the POS menu'} />
            </div>
          </div>
          <fieldset className="field product-form__wide product-form__choices">
            <legend className="field__label">Choice Groups</legend>
            {choiceGroups.filter((g) => g.active || form.choiceGroupIds.includes(g.id)).length === 0 ? (
              <span className="field__hint">No choice groups yet — create them in Admin → Choices.</span>
            ) : (
              <div className="product-form__choice-list">
                {choiceGroups
                  .filter((g) => g.active || form.choiceGroupIds.includes(g.id))
                  .map((g) => (
                    <label key={g.id} className="product-form__choice">
                      <input
                        type="checkbox"
                        checked={form.choiceGroupIds.includes(g.id)}
                        onChange={(e) =>
                          set('choiceGroupIds', e.target.checked ? [...form.choiceGroupIds, g.id] : form.choiceGroupIds.filter((id) => id !== g.id))
                        }
                      />
                      {g.name}
                      {!g.active && <em> (inactive)</em>}
                    </label>
                  ))}
              </div>
            )}
          </fieldset>
          {saveError && (
            <div className="field product-form__wide api-status api-status--error" role="alert">
              {saveError}
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
