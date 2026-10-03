import { useState } from 'react';
import { LineChart } from 'lucide-react';
import EmptyState from '../../ui/EmptyState';
import { formatPeso } from '../../../utils/currency';
import { useWidth } from './useWidth';
import type { TrendPoint } from './analyticsData';

const HEIGHT = 280;
const PAD = { top: 28, right: 8, bottom: 30, left: 8 };
const UNIT_LABEL = { hour: 'Hourly', day: 'Daily', week: 'Weekly' };

interface SalesAnalyticsProps {
  points: TrendPoint[];
  unit: 'hour' | 'day' | 'week';
  compare: boolean;
  rangeLabel: string;
}

// Revenue trend: one bar per bucket, peak highlighted and labelled, optional
// dashed line for the previous period. Hover shows a tooltip per bar.
export default function SalesAnalytics({ points, unit, compare, rangeLabel }: SalesAnalyticsProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const hasData = points.some((p) => p.value > 0);

  const total = points.reduce((s, p) => s + p.value, 0);
  const peak = points.reduce((best, p, i) => (p.value > points[best].value ? i : best), 0);
  const max = Math.max(1, ...points.map((p) => Math.max(p.value, p.previous ?? 0))) * 1.12;
  const innerW = Math.max(width - PAD.left - PAD.right, 0);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const slot = points.length ? innerW / points.length : 0;
  const barW = Math.max(2, Math.min(28, slot * 0.62));
  const cx = (i: number) => PAD.left + slot * i + slot / 2;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const baseline = PAD.top + innerH;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(innerW / 64))));
  const prevLine = compare ? points.map((p, i) => `${i ? 'L' : 'M'}${cx(i)},${y(p.previous ?? 0)}`).join(' ') : '';
  const active = hover ?? peak;
  const tipLeft = Math.min(Math.max(cx(active), 90), Math.max(width - 90, 90));

  // Weekend vs weekday average (daily view only).
  const weekendNote = (() => {
    if (unit !== 'day' || points.length < 7) return null;
    const split = points.reduce(
      (acc, p) => {
        const d = p.date!.getDay();
        const k = d === 0 || d === 6 ? 'we' : 'wd';
        acc[k].sum += p.value;
        acc[k].n += 1;
        return acc;
      },
      { we: { sum: 0, n: 0 }, wd: { sum: 0, n: 0 } },
    );
    if (!split.we.n || !split.wd.n || !split.wd.sum) return null;
    return Math.round(((split.we.sum / split.we.n) / (split.wd.sum / split.wd.n) - 1) * 100);
  })();

  return (
    <section className="an-card">
      <header className="an-card__head">
        <div>
          <h2>Sales Performance</h2>
          <p>
            {UNIT_LABEL[unit]} gross sales · {rangeLabel}
          </p>
        </div>
        {hasData && (
          <div className="an-card__stat">
            <span>Period total</span>
            <strong>{formatPeso(total)}</strong>
          </div>
        )}
      </header>

      {!hasData ? (
        <EmptyState icon={<LineChart size={22} />} title="No sales data yet" description="Complete transactions to start viewing sales analytics." />
      ) : (
        <>
          <div className="an-chart" ref={ref} onMouseLeave={() => setHover(null)}>
            {width > 0 && (
              <svg width={width} height={HEIGHT} role="img" aria-label={`Sales trend, peak ${points[peak].label} at ${formatPeso(points[peak].value)}`}>
                {[0.25, 0.5, 0.75, 1].map((f) => (
                  <line key={f} x1={PAD.left} x2={width - PAD.right} y1={baseline - f * innerH} y2={baseline - f * innerH} className="an-chart__grid" />
                ))}
                {points.map((p, i) => {
                  const h = Math.max(0, baseline - y(p.value));
                  return (
                    <g key={i}>
                      <rect
                        x={cx(i) - barW / 2}
                        y={baseline - h}
                        width={barW}
                        height={h}
                        rx={Math.min(4, barW / 2)}
                        className={`an-bar ${i === peak ? 'an-bar--peak' : ''} ${hover !== null && hover !== i ? 'an-bar--dim' : ''}`}
                      />
                      <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
                    </g>
                  );
                })}
                {compare && <path d={prevLine} className="an-chart__prev" />}
                <line x1={PAD.left} x2={width - PAD.right} y1={baseline} y2={baseline} className="an-chart__axis" />
                {points.map((p, i) =>
                  i === peak || i === points.length - 1 || (i % labelEvery === 0 && Math.abs(i - peak) >= labelEvery && points.length - 1 - i >= labelEvery) ? (
                    <text key={i} x={cx(i)} y={HEIGHT - 10} textAnchor="middle" className={`an-chart__label ${i === peak ? 'an-chart__label--peak' : ''}`}>
                      {p.label}
                      {i === peak ? ' (Peak)' : ''}
                    </text>
                  ) : null,
                )}
              </svg>
            )}
            {width > 0 && (
              <div className="an-tip" style={{ left: tipLeft, top: Math.max(y(points[active].value) - 58, 0) }}>
                <strong>{points[active].label}</strong>
                <span>{formatPeso(points[active].value)}</span>
                <em>
                  {points[active].orders} orders{compare && points[active].previous !== null ? ` · prev ${formatPeso(points[active].previous!)}` : ''}
                </em>
              </div>
            )}
          </div>
          <footer className="an-card__foot">
            <span>
              {weekendNote !== null && (
                <>
                  <i className="an-dot an-dot--peak" /> <b>Weekend velocity:</b> {weekendNote >= 0 ? '+' : ''}
                  {weekendNote}% average revenue vs weekdays
                </>
              )}
            </span>
            <span className="an-legend">
              <i className="an-legend__bar" /> Current period
              {compare && (
                <>
                  <i className="an-legend__dash" /> Previous period
                </>
              )}
            </span>
          </footer>
        </>
      )}
    </section>
  );
}
