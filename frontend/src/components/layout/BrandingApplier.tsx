import { useEffect } from 'react';
import { normalizeHex, useBrandingSettings } from '../../stores/brandingSettingsStore';

/** Mix a hex color toward white (amount > 0) or black (amount < 0); used for hover shades. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) => Math.round(amount > 0 ? c + (255 - c) * amount : c * (1 + amount));
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(channel);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// Settings → Branding applied to the app (BRD-02): the saved colors replace the brand, accent and
// background design tokens. Nothing changes until the section is configured; semantic status colors
// (success / warning / danger) are never overridden.
export default function BrandingApplier() {
  const { settings, configured } = useBrandingSettings();
  useEffect(() => {
    const root = document.documentElement.style;
    const primary = normalizeHex(settings.primary);
    const accent = normalizeHex(settings.accent);
    const background = normalizeHex(settings.background);
    const vars: [string, string | null][] = [
      ['--color-brand', primary],
      ['--color-brand-hover', primary && shade(primary, 0.12)],
      ['--color-accent', accent],
      ['--color-accent-soft', accent && shade(accent, 0.82)],
      ['--color-bg', background],
    ];
    for (const [name, value] of vars) {
      if (configured && value) root.setProperty(name, value);
      else root.removeProperty(name);
    }
  }, [settings, configured]);
  return null;
}
