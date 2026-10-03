import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}

export default function Badge({ tone = 'neutral', dot, children }: BadgeProps) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot && <span className="status-dot" />}
      {children}
    </span>
  );
}
