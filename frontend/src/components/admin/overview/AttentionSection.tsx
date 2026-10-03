import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, ChevronRight, CircleHelp, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import EmptyState from '../../ui/EmptyState';
import type { AttentionItem } from '../../../pages/Admin/adminOverviewData';

const icons: Record<AttentionItem['tone'], LucideIcon> = {
  warning: AlertTriangle,
  danger: Clock,
  info: CircleHelp,
};

export default function AttentionSection({ items }: { items: AttentionItem[] }) {
  return (
    <section className="ov-card attention">
      <header className="ov-card__header">
        <div className="ov-card__title-row">
          <h2 className="ov-card__title">Attention &amp; Alerts</h2>
          <span className="attention__count">{items.length}</span>
        </div>
      </header>
      <div className="attention__list">
        {items.length === 0 && <EmptyState title="Nothing needs attention" description="Alerts appear here when products run low on stock." />}
        {items.map((item) => {
          const Icon = icons[item.tone];
          return (
            <article key={item.id} className={`alert alert--${item.tone}`}>
              <span className="alert__icon">
                <Icon size={17} />
              </span>
              <div className="alert__body">
                <div className="alert__top">
                  <span className="alert__kicker">{item.kicker}</span>
                  <span className="alert__meta">{item.meta}</span>
                </div>
                <strong className="alert__title">{item.title}</strong>
                <p className="alert__detail">{item.detail}</p>
                {item.action.to && (
                  <Link to={item.action.to} className="alert__action">
                    {item.action.label} <ChevronRight size={13} />
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
