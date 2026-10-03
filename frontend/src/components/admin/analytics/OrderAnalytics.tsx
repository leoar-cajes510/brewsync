import { useState } from 'react';
import { Banknote, Clock, Coffee, CreditCard, Landmark, Smartphone, Sun, Wallet } from 'lucide-react';
import EmptyState from '../../ui/EmptyState';
import { formatPeso } from '../../../utils/currency';
import { useWidth } from './useWidth';
import { OPEN_HOUR, type HourlyStats, type Split } from './analyticsData';

const HEIGHT = 190;
const PAD = { top: 16, right: 4, bottom: 24, left: 4 };
const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`;
const hourText = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`;

// Hourly order distribution + the busiest morning/afternoon windows.
export default function OrderAnalytics({ stats }: { stats: HourlyStats }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const { counts, total, morning, afternoon, busiestDay } = stats;

  const innerW = Math.max(width - PAD.left - PAD.right, 0);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const slot = innerW / counts.length;
  const barW = Math.min(30, slot * 0.6);
  const max = Math.max(1, ...counts) * 1.1;
  const baseline = PAD.top + innerH;
  const inWindow = (h: number) => [morning, afternoon].some((w) => w && h >= w.from && h < w.to);

  return (
    <section className="an-card">
      <header className="an-card__head">
        <div>
          <h2>Hourly Distribution &amp; Peak Trading Windows</h2>
          <p>Orders by hour, 7:00 AM opening to 9:00 PM close</p>
        </div>
        {busiestDay && (
          <span className="an-chip-note">
            Busiest Day: {busiestDay.name} ({busiestDay.share}%)
          </span>
        )}
      </header>

      {total === 0 ? (
        <EmptyState icon={<Clock size={22} />} title="No order activity yet" description="Peak hours appear once orders are completed." />
      ) : (
        <>
          <div className="an-chart" ref={ref} onMouseLeave={() => setHover(null)}>
            {width > 0 && (
              <svg width={width} height={HEIGHT} role="img" aria-label="Orders by hour of day">
                <line x1={PAD.left} x2={width - PAD.right} y1={baseline} y2={baseline} className="an-chart__axis" />
                {counts.map((c, i) => {
                  const h = OPEN_HOUR + i;
                  const bh = (c / max) * innerH;
                  const x = PAD.left + slot * i + slot / 2;
                  return (
                    <g key={h} onMouseEnter={() => setHover(i)}>
                      <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={innerH} fill="transparent" />
                      <rect
                        x={x - barW / 2}
                        y={baseline - bh}
                        width={barW}
                        height={bh}
                        rx={Math.min(4, barW / 2)}
                        className={`an-bar ${inWindow(h) ? 'an-bar--peak' : 'an-bar--soft'} ${hover !== null && hover !== i ? 'an-bar--dim' : ''}`}
                      />
                      <text x={x} y={HEIGHT - 6} textAnchor="middle" className="an-chart__label">
                        {hourLabel(h)}
                      </text>
                      {hover === i && (
                        <text x={x} y={Math.max(baseline - bh - 6, 12)} textAnchor="middle" className="an-chart__value">
                          {c}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
          <div className="an-windows">
            {[
              { w: morning, label: 'Morning Rush Window', icon: Sun },
              { w: afternoon, label: 'Afternoon Peak Window', icon: Coffee },
            ].map(({ w, label, icon: Icon }) => (
              <div key={label} className="an-window">
                <span className="an-window__icon">
                  <Icon size={18} />
                </span>
                <div>
                  <span>{label}</span>
                  <strong>
                    {w ? (
                      <>
                        {hourText(w.from)} – {hourText(w.to)} · <em>{w.share}% of volume</em>
                      </>
                    ) : (
                      'Not enough data yet'
                    )}
                  </strong>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

const PAY_ICON: Record<string, typeof Banknote> = { Cash: Banknote, GCash: Smartphone, Card: CreditCard, 'Bank Transfer': Landmark };

// Order type (channel) distribution + settlement (payment) methods.
export function ChannelSplits({ channels, payments }: { channels: Split[]; payments: Split[] }) {
  const empty = channels.every((c) => c.count === 0);
  return (
    <section className="an-card an-card--side">
      <header className="an-card__head">
        <h2>Channel &amp; Payment Splits</h2>
      </header>
      {empty ? (
        <EmptyState icon={<Wallet size={22} />} title="No orders yet" description="Order types and payment methods appear after sales are completed." />
      ) : (
        <>
          <div className="an-channels">
            {channels.map((c) => (
              <div key={c.name} className="an-channel">
                <span>{c.name}</span>
                <strong>{c.share}%</strong>
                <em>{c.count} ord</em>
              </div>
            ))}
          </div>
          <span className="an-subhead">Settlement Methods</span>
          <ul className="an-pay">
            {payments.map((p) => {
              const Icon = PAY_ICON[p.name] ?? Wallet;
              return (
                <li key={p.name}>
                  <Icon size={16} />
                  <span>{p.name}</span>
                  <em>{p.share}%</em>
                  <strong>{formatPeso(p.amount)}</strong>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
