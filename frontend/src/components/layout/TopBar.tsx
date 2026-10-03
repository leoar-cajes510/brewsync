import type { ReactNode } from 'react';

interface TopBarProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
}

// Page header: title block on the left, page actions on the right.
export default function TopBar({ title, subtitle, badge, actions }: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="top-bar__titles">
        <div className="top-bar__title-row">
          <h1 className="top-bar__title">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="top-bar__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="top-bar__actions">{actions}</div>}
    </header>
  );
}
