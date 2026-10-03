import type { ReactNode } from 'react';
import { Outlet, useMatches } from 'react-router-dom';
import TopBar from './TopBar';

/** Optional per-route header override: `handle: { title, subtitle }` on a child route. */
interface SectionHandle {
  title?: string;
  subtitle?: string;
}

interface SectionLayoutProps {
  title: string;
  subtitle: string;
  badge?: ReactNode;
  actions?: ReactNode;
  nav: ReactNode;
}

// Shared frame for Admin and Settings: page header, section tabs, then the page body.
export default function SectionLayout({ title, subtitle, badge, actions, nav }: SectionLayoutProps) {
  const matches = useMatches();
  const handle = matches[matches.length - 1]?.handle as SectionHandle | undefined;

  return (
    <div className="page">
      <TopBar title={handle?.title ?? title} subtitle={handle?.subtitle ?? subtitle} badge={badge} actions={actions} />
      <div className="page__subnav">{nav}</div>
      <div className="page__body">
        <Outlet />
      </div>
    </div>
  );
}
