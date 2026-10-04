import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the `branding` settings section on the server.
const server: { data: Record<string, unknown> | null; version: number } = { data: null, version: 0 };

vi.mock('./authStore', () => ({ currentPermissions: () => ['settings.view'] }));
vi.mock('../services/settingsService', () => ({
  getSection: async () => ({ data: server.data, version: server.version, configured: server.version > 0 }),
  putSection: async (_s: string, _v: number, data: Record<string, unknown>) => {
    server.data = JSON.parse(JSON.stringify(data));
    server.version += 1;
    return { data: server.data, version: server.version, configured: true };
  },
  getOperational: async () => ({}),
}));

const logo = { dataUrl: 'data:image/webp;base64,AAAA', fileName: 'shop.png', width: 256, height: 128 };

describe('branding logo', () => {
  beforeEach(() => {
    server.data = null;
    server.version = 0;
    vi.resetModules();
  });

  it('serializes the logo into the section data', async () => {
    const { brandingToData, BRANDING_DEFAULTS } = await import('./brandingSettingsStore');
    const data = brandingToData({ ...BRANDING_DEFAULTS, primary: '#112233', logo }, { other: 1 });
    expect(data).toMatchObject({ logo, primary: '#112233', other: 1 });
  });

  it('deserializes a stored logo and ignores invalid ones', async () => {
    const { brandingFromData } = await import('./brandingSettingsStore');
    expect(brandingFromData({ logo, primary: '#112233' })).toMatchObject({ logo, primary: '#112233' });
    expect(brandingFromData({}).logo).toBeNull();
    expect(brandingFromData({ logo: { dataUrl: 'javascript:alert(1)' } }).logo).toBeNull();
  });

  it('keeps the logo and colors after a reload', async () => {
    const first = await import('./brandingSettingsStore');
    await first.loadBrandingSettings();
    await first.saveBrandingSettings({ ...first.BRANDING_DEFAULTS, accent: '#AA5500', logo });

    vi.resetModules(); // fresh page: no in-memory state survives
    const reloaded = await import('./brandingSettingsStore');
    await reloaded.loadBrandingSettings();
    expect(reloaded.getBrandingState().settings).toMatchObject({ logo, accent: '#AA5500' });

    await reloaded.saveBrandingSettings({ ...reloaded.getBrandingState().settings, logo: null });
    vi.resetModules();
    const again = await import('./brandingSettingsStore');
    await again.loadBrandingSettings();
    expect(again.getBrandingState().settings.logo).toBeNull();
  });
});
