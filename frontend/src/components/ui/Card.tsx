import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  actions?: ReactNode;
  padded?: boolean;
}

export default function Card({ title, actions, padded = true, className = '', children, ...rest }: CardProps) {
  return (
    <div className={`card ${padded ? 'card--padded' : ''} ${className}`} {...rest}>
      {(title || actions) && (
        <div className="card__header">
          {title && <h3 className="card__title">{title}</h3>}
          {actions && <div className="card__actions">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
