import { createSectionStore } from './sectionStore';

// Branding (Settings → Branding), stored in the `branding` settings section. Defaults are
// BrewSync's neutral system theme until the business saves its own colors. The logo is kept in the
// same section as an optimized data URL (raster images downscaled client-side; SVG kept as-is).

export interface BrandLogo {
  /** Optimized image as a data URL, persisted with the branding section. */
  dataUrl: string;
  fileName: string;
  width: number;
  height: number;
}

export interface BrandingSettings {
  logo: BrandLogo | null;
  primary: string;
  accent: string;
  background: string;
}

export const BRANDING_DEFAULTS: BrandingSettings = {
  logo: null,
  primary: '#3B2620',
  accent: '#C08A5B',
  background: '#F5F3EF',
};

type Data = Record<string, unknown>;

const isLogo = (v: unknown): v is BrandLogo =>
  !!v && typeof v === 'object' && typeof (v as BrandLogo).dataUrl === 'string' && (v as BrandLogo).dataUrl.startsWith('data:image/');

export const brandingFromData = (d: Data): BrandingSettings => {
  const logo = isLogo(d.logo) ? { dataUrl: d.logo.dataUrl, fileName: String(d.logo.fileName ?? ''), width: Number(d.logo.width) || 0, height: Number(d.logo.height) || 0 } : null;
  return { ...BRANDING_DEFAULTS, ...(d as Partial<BrandingSettings>), logo };
};

export const brandingToData = (s: BrandingSettings, current: Data | null): Data => ({ ...(current ?? {}), ...s, logo: s.logo ?? null });

const store = createSectionStore<BrandingSettings>('branding', BRANDING_DEFAULTS, brandingFromData, brandingToData);

export const useBrandingSettings = store.use;
export const loadBrandingSettings = store.load;
export const getBrandingState = store.get;
export const saveBrandingSettings = (settings: BrandingSettings) => store.save(settings);

/* ------------------------------ Color helpers ----------------------------- */

/** Accepts "#abc", "abc", "#aabbcc", "aabbcc"; returns "#AABBCC" or null. */
export function normalizeHex(input: string): string | null {
  const v = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) return `#${v.split('').map((c) => c + c).join('')}`.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(v)) return `#${v}`.toUpperCase();
  return null;
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Readable text color (white or near-black) for a given background. */
export const textOn = (hex: string) => (contrast(hex, '#FFFFFF') >= contrast(hex, '#1C1917') ? '#FFFFFF' : '#1C1917');

function hue(hex: string) {
  const [r, g, b] = channels(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  if (d === 0) return { h: 0, s: 0 };
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s };
}

/** True when a brand color is a saturated hue close to a semantic status color. */
export function resemblesStatus(brand: string, status: string) {
  const a = hue(brand);
  const b = hue(status);
  const diff = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h));
  return a.s > 0.45 && diff < 18;
}
