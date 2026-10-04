import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { BrandLogo } from '../../stores/brandingSettingsStore';

let logo: BrandLogo | null = null;

vi.mock('../../stores/authStore', () => ({ can: () => true, useAuth: () => ({ user: null }) }));
vi.mock('../../stores/terminologySettingsStore', () => ({ useTerms: () => ({ terms: (k: string) => k }) }));
vi.mock('../../stores/brandingSettingsStore', () => ({ useBrandingSettings: () => ({ settings: { logo } }) }));
vi.mock('./UserTerminalPanel', () => ({ default: () => null }));

const { default: MainSidebar } = await import('./MainSidebar');
const brand = () => {
  const html = renderToStaticMarkup(<MemoryRouter><MainSidebar /></MemoryRouter>);
  return html.slice(html.indexOf('main-sidebar__logo'), html.indexOf('main-sidebar__name'));
};

describe('MainSidebar logo', () => {
  it('falls back to the Coffee icon when no logo is saved', () => {
    logo = null;
    expect(brand()).toContain('<svg');
    expect(brand()).not.toContain('<img');
  });

  it('shows the saved business logo', () => {
    logo = { dataUrl: 'data:image/png;base64,AAAA', fileName: 'l.png', width: 1, height: 1 };
    expect(brand()).toContain('src="data:image/png;base64,AAAA"');
    expect(brand()).not.toContain('<svg');
  });
});
