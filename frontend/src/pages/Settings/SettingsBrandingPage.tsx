import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Coffee, ImagePlus, Info, Lock, MonitorSmartphone, Palette, RefreshCw, RotateCcw, Save, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import ColorField from '../../components/settings/ColorField';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import {
  BRANDING_DEFAULTS,
  contrast,
  resemblesStatus,
  saveBrandingSettings,
  textOn,
  useBrandingSettings,
  type BrandLogo,
  type BrandingSettings,
} from '../../stores/brandingSettingsStore';
import { useBusinessSettings } from '../../stores/businessSettingsStore';
import { errorMessage } from '../../services/api';
import '../../components/settings/settingsBranding.css';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

// System status colors come from the app theme tokens and are never editable.
const SEMANTIC = [
  { key: 'success', label: 'Success / Paid', token: '--color-success', icon: CheckCircle2 },
  { key: 'warning', label: 'Warning / Low Stock', token: '--color-warning', icon: AlertTriangle },
  { key: 'danger', label: 'Error / Voided', token: '--color-danger', icon: XCircle },
  { key: 'info', label: 'Info', token: '--color-info', icon: Info },
] as const;

const sameBranding = (a: BrandingSettings, b: BrandingSettings) =>
  a.primary === b.primary && a.accent === b.accent && a.background === b.background && a.logo?.dataUrl === b.logo?.dataUrl;

const LOGO_MAX_SIDE = 256;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file is not a readable image.'));
    img.src = src;
  });

// Raster logos are downscaled to ~256px on the longest side (aspect ratio kept) and re-encoded:
// JPEG stays JPEG; PNG/WEBP become WEBP (alpha kept; browsers without WEBP encoding fall back to PNG).
// SVG is stored as-is, never rasterized.
function readLogo(file: File): Promise<BrandLogo> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file. Try another image.'));
    reader.onload = async () => {
      try {
        const source = String(reader.result);
        const img = await loadImage(source);
        const { naturalWidth: w, naturalHeight: h } = img;
        if (file.type === 'image/svg+xml') return resolve({ dataUrl: source, fileName: file.name, width: w, height: h });
        const scale = Math.min(1, LOGO_MAX_SIDE / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve({ dataUrl: source, fileName: file.name, width: w, height: h });
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.85) : canvas.toDataURL('image/webp', 0.9);
        resolve({ dataUrl, fileName: file.name, width: canvas.width, height: canvas.height });
      } catch (e) {
        reject(e);
      }
    };
    reader.readAsDataURL(file);
  });
}

// Visual brand identity only. Edits apply to the live preview immediately and
// are saved to the `branding` settings section, including the optimized logo.
export default function SettingsBrandingPage() {
  const { settings: saved, savedAt } = useBrandingSettings();
  const { settings: business } = useBusinessSettings();
  const [form, setForm] = useState<BrandingSettings>(saved);
  // Show the server copy once it loads (and after each save).
  useEffect(() => setForm(saved), [saved]);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [semantic, setSemantic] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    setSemantic(Object.fromEntries(SEMANTIC.map((s) => [s.key, css.getPropertyValue(s.token).trim().toUpperCase()])));
  }, []);

  const set = (patch: Partial<BrandingSettings>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = !sameBranding(form, saved);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) return setLogoError('Use a PNG, JPG, WEBP, or SVG image.');
    if (file.size > MAX_LOGO_BYTES) return setLogoError('Logo must be 2 MB or smaller.');
    try {
      const logo = await readLogo(file);
      setLogoError(null);
      set({ logo });
    } catch (e) {
      setLogoError((e as Error).message);
    }
  };

  // Readability checks (warnings only; semantic colors are never changed).
  const primaryText = textOn(form.primary);
  const warnings = [
    contrast(form.primary, form.background) < 3 && 'Primary color is hard to see against the background.',
    contrast(form.accent, form.background) < 1.6 && 'Accent color blends into the background.',
    ...SEMANTIC.flatMap((s) =>
      semantic[s.key] && [form.primary, form.accent].some((c) => resemblesStatus(c, semantic[s.key]))
        ? [`A brand color looks similar to the ${s.label.split(' /')[0].toLowerCase()} status color — status badges keep their own color and icon, but consider a more distinct shade.`]
        : [],
    ),
  ].filter(Boolean) as string[];

  const save = async () => {
    try {
      await saveBrandingSettings(form);
      setFeedback('Branding saved');
    } catch (e) {
      setFeedback(errorMessage(e));
    }
  };

  const reset = () => {
    setForm(BRANDING_DEFAULTS);
    setLogoError(null);
    setConfirmReset(false);
    setFeedback('Branding reset to defaults — Save Changes to apply');
  };

  const businessName = business.name.trim() || 'Your Business';
  const preview = {
    '--pv-primary': form.primary,
    '--pv-primary-text': primaryText,
    '--pv-accent': form.accent,
    '--pv-accent-text': textOn(form.accent),
    '--pv-bg': form.background,
    '--pv-bg-text': textOn(form.background),
  } as React.CSSProperties;

  return (
    <div className="settings-branding">
      <div className="br-main">
        {/* Logo */}
        <section className="br-card">
          <header className="br-card__head">
            <div>
              <h2>
                <ImagePlus size={16} /> Business Logo
              </h2>
              <p>Your brand mark for BrewSync navigation, customer-facing screens, and receipt headers.</p>
            </div>
            <Badge tone={form.logo ? 'success' : 'neutral'}>{form.logo ? 'Logo added' : 'No logo'}</Badge>
          </header>
          <div
            className={`br-logo ${dragging ? 'br-logo--drag' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pickFile(e.dataTransfer.files[0]);
            }}
          >
            <div className="br-logo__frame">
              {form.logo ? (
                <img src={form.logo.dataUrl} alt="Business logo preview" />
              ) : (
                <span className="br-logo__empty">
                  <ImagePlus size={22} />
                  No logo yet
                </span>
              )}
            </div>
            <div className="br-logo__info">
              {form.logo && (
                <p className="br-logo__file">
                  <strong>{form.logo.fileName}</strong>
                  <span>
                    {form.logo.width} × {form.logo.height}px
                  </span>
                </p>
              )}
              <div className="br-logo__buttons">
                {form.logo ? (
                  <>
                    <Button icon={<RefreshCw size={14} />} onClick={() => fileRef.current?.click()}>
                      Replace Logo
                    </Button>
                    <Button className="br-logo__remove" icon={<Trash2 size={14} />} onClick={() => set({ logo: null })}>
                      Remove
                    </Button>
                  </>
                ) : (
                  <Button variant="primary" icon={<ImagePlus size={14} />} onClick={() => fileRef.current?.click()}>
                    Upload Logo
                  </Button>
                )}
              </div>
              <p className="br-hint">
                <Info size={13} /> PNG, JPG, WEBP, or SVG · square works best (at least 512 × 512px) · max 2 MB. You can also drop a file here.
              </p>
              {logoError && <span className="field__error">{logoError}</span>}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={LOGO_TYPES.join(',')}
              hidden
              data-testid="logo-input"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </section>

        {/* Brand colors */}
        <section className="br-card">
          <header className="br-card__head">
            <div>
              <h2>
                <Palette size={16} /> Brand Colors
              </h2>
              <p>The palette used for primary buttons, active states, and surface accents.</p>
            </div>
          </header>
          <div className="br-colors">
            <ColorField label="Primary Color" tag="Primary" description="Primary buttons, active navigation, and key headings." value={form.primary} onChange={(primary) => set({ primary })} />
            <ColorField label="Accent Color" tag="Accent" description="Highlights, selected tabs, and secondary emphasis." value={form.accent} onChange={(accent) => set({ accent })} />
            <ColorField label="Background Color" tag="Surface" description="The workspace background behind cards and panels." value={form.background} onChange={(background) => set({ background })} />
          </div>
          {warnings.length > 0 && (
            <ul className="br-warnings" role="status">
              {warnings.map((w) => (
                <li key={w}>
                  <AlertTriangle size={13} /> {w}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Semantic colors */}
        <section className="br-card">
          <header className="br-card__head">
            <div>
              <h2>
                <ShieldCheck size={16} /> System Status Colors
              </h2>
              <p>Fixed colors for success, warning, error, and information states.</p>
            </div>
            <Badge tone="warning">
              <Lock size={11} /> System Protected
            </Badge>
          </header>
          <p className="br-protected">
            <Lock size={13} /> These colors can’t be changed by branding, so paid, low-stock, and voided states always look the same to your team.
          </p>
          <div className="br-semantic">
            {SEMANTIC.map(({ key, label, token, icon: Icon }) => (
              <div key={key} className={`br-semantic__item br-semantic__item--${key}`}>
                <span className="br-semantic__dot" style={{ background: `var(${token})` }} />
                <div>
                  <strong>{label}</strong>
                  <span>{semantic[key] || '—'}</span>
                </div>
                <Icon size={14} />
              </div>
            ))}
          </div>
        </section>

        <p className="br-note">
          <Info size={14} /> Branding changes affect the visual appearance of BrewSync. System status colors such as success, warning, and error remain consistent for clarity.
        </p>
      </div>

      {/* Live preview */}
      <aside className="br-side">
        <section className="br-card">
          <header className="br-card__head">
            <div>
              <h2>
                <MonitorSmartphone size={16} /> Live Preview
              </h2>
              <p>Updates instantly as you change your branding.</p>
            </div>
            <Badge tone="success" dot>
              Live
            </Badge>
          </header>
          <div className="br-preview" style={preview} aria-label="Branding preview">
            <div className="pv-shell">
              <nav className="pv-rail" aria-hidden>
                <span className="pv-rail__logo">{form.logo ? <img src={form.logo.dataUrl} alt="" /> : <Coffee size={14} />}</span>
                <span className="pv-rail__item pv-rail__item--active" />
                <span className="pv-rail__item" />
                <span className="pv-rail__item" />
              </nav>
              <div className="pv-body">
                <div className="pv-header">
                  <span className="pv-header__brand">
                    {form.logo ? <img src={form.logo.dataUrl} alt="" /> : <Coffee size={14} />}
                    <strong>{businessName}</strong>
                  </span>
                  <span className="pv-header__reg">● Register 01</span>
                </div>
                <div className="pv-tabs">
                  <span className="pv-tab pv-tab--active">Espresso</span>
                  <span className="pv-tab">Cold Brew</span>
                  <span className="pv-tab">Pastries</span>
                </div>
                <div className="pv-item">
                  <span className="pv-item__img">
                    <Coffee size={18} />
                  </span>
                  <div>
                    <strong>Sample Item</strong>
                    <em>Preview only</em>
                    <span className="pv-chip">✓ Selected option</span>
                  </div>
                  <b>{business.currencySymbol || '₱'}160.00</b>
                </div>
                <div className="pv-status">
                  <span className="pv-badge pv-badge--success">Paid</span>
                  <span className="pv-badge pv-badge--warning">Low Stock</span>
                  <span className="pv-badge pv-badge--danger">Voided</span>
                </div>
                <button type="button" className="pv-button" tabIndex={-1}>
                  <span>Complete Charge</span>
                  <span>{business.currencySymbol || '₱'}160.00</span>
                </button>
              </div>
            </div>
          </div>
          <p className="br-preview__caption">
            Rendered with <code>{form.primary}</code> primary, <code>{form.accent}</code> accent, and <code>{form.background}</code> background. Status badges keep their system colors.
          </p>
        </section>
      </aside>

      <footer className="br-actions">
        <span className="br-actions__state">
          {dirty ? 'You have unsaved changes.' : savedAt ? `Saved ${savedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.` : 'Using BrewSync default branding.'}
        </span>
        <div className="br-actions__buttons">
          <Button icon={<RotateCcw size={15} />} disabled={sameBranding(form, BRANDING_DEFAULTS)} onClick={() => setConfirmReset(true)}>
            Reset to Defaults
          </Button>
          <Button disabled={!dirty} onClick={() => setForm(saved)}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Save size={15} />} disabled={!dirty} onClick={save}>
            Save Changes
          </Button>
        </div>
      </footer>

      <ConfirmDialog
        open={confirmReset}
        title="Reset branding to defaults?"
        message="The logo is removed and colors return to BrewSync’s default theme. Nothing changes until you Save Changes."
        confirmLabel="Reset Branding"
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
      />
      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}
