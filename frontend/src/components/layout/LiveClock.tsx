import { Clock } from 'lucide-react';

function formatClock(date: Date) {
  const day = date.toLocaleDateString(undefined, { weekday: 'short' });
  const rest = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${day} · ${rest}, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

// Header clock ("Thu · Sep 24, 05:14 PM"); the caller owns the ticking `now`.
export default function LiveClock({ now, className = '' }: { now: Date; className?: string }) {
  return (
    <span className={`live-clock ${className}`}>
      <Clock size={15} /> {formatClock(now)}
    </span>
  );
}
