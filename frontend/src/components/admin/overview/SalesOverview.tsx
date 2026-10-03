import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import Tabs from '../../ui/Tabs';
import EmptyState from '../../ui/EmptyState';
import type { SalesPeriod, SalesSeries } from '../../../pages/Admin/adminOverviewData';
import { formatPeso } from '../../../utils/currency';

const periods = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
];

const subtitles: Record<SalesPeriod, string> = { today: 'Hourly Volume', week: 'Daily Volume', month: 'Weekly Volume' };

const PAD = { top: 44, right: 20, bottom: 36, left: 20 };
const HEIGHT = 300;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

interface SalesOverviewProps {
  period: SalesPeriod;
  onPeriodChange: (p: SalesPeriod) => void;
  /** null until sales analytics (GET /analytics/sales) is available. */
  series: SalesSeries | null;
}

// Single-series area chart; hover shows a crosshair + tooltip, the peak is labelled by default.
export default function SalesOverview({ period, onPeriodChange, series }: SalesOverviewProps) {
  if (!series || series.points.length === 0) {
    return (
      <section className="ov-card sales-overview">
        <header className="sales-overview__head">
          <div>
            <div className="ov-card__title-row">
              <h2 className="ov-card__title">Sales Overview</h2>
              <span className="ov-chip">{subtitles[period]}</span>
            </div>
            <div className="sales-overview__total">
              <strong>—</strong>
            </div>
          </div>
          <Tabs items={periods} value={period} onChange={(v) => onPeriodChange(v as SalesPeriod)} />
        </header>
        <EmptyState title="No sales data yet" description="No completed sales in this period yet." />
      </section>
    );
  }
  return <SalesChart period={period} onPeriodChange={onPeriodChange} series={series} />;
}

function SalesChart({ period, onPeriodChange, series }: SalesOverviewProps & { series: SalesSeries }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const { points } = series;

  const peakIndex = points.reduce((best, p, i) => (p.value > points[best].value ? i : best), 0);
  const max = Math.max(...points.map((p) => p.value)) * 1.15;
  const innerW = Math.max(width - PAD.left - PAD.right, 0);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const baseline = PAD.top + innerH;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${baseline} L${x(0)},${baseline} Z`;
  const active = hover ?? peakIndex;
  const grid = [0.25, 0.5, 0.75, 1].map((f) => PAD.top + innerH - f * innerH);

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let nearest = 0;
    points.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(nearest) - px)) nearest = i;
    });
    setHover(nearest);
  };

  const tipLeft = Math.min(Math.max(x(active), 70), width - 70);

  return (
    <section className="ov-card sales-overview">
      <header className="sales-overview__head">
        <div>
          <div className="ov-card__title-row">
            <h2 className="ov-card__title">Sales Overview</h2>
            <span className="ov-chip">{subtitles[period]}</span>
          </div>
          <div className="sales-overview__total">
            <strong>{formatPeso(series.total)}</strong>
            <span>
              <ArrowUp size={14} /> {series.peakNote}
            </span>
          </div>
        </div>
        <Tabs items={periods} value={period} onChange={(v) => onPeriodChange(v as SalesPeriod)} />
      </header>

      <div ref={ref} className="sales-chart">
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={`Sales ${subtitles[period].toLowerCase()}, peak ${points[peakIndex].label} at ${formatPeso(points[peakIndex].value)}`}>
            <defs>
              <linearGradient id="sales-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-series)" stopOpacity="0.16" />
                <stop offset="100%" stopColor="var(--chart-series)" stopOpacity="0.01" />
              </linearGradient>
            </defs>

            {grid.map((gy) => (
              <line key={gy} x1={PAD.left} x2={width - PAD.right} y1={gy} y2={gy} className="sales-chart__grid" />
            ))}
            <line x1={PAD.left} x2={width - PAD.right} y1={baseline} y2={baseline} className="sales-chart__axis" />

            <path d={area} fill="url(#sales-fill)" />
            <path d={line} className="sales-chart__line" />

            <line x1={x(active)} x2={x(active)} y1={y(points[active].value) + 8} y2={baseline} className="sales-chart__crosshair" />

            {points.map((p, i) => (
              <circle key={p.label} cx={x(i)} cy={y(p.value)} r={i === active ? 6 : 4.5} className={`sales-chart__dot ${i === active ? 'sales-chart__dot--active' : ''}`} />
            ))}

            {points.map((p, i) => (
              <text key={p.label} x={x(i)} y={HEIGHT - 12} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className={`sales-chart__label ${i === peakIndex ? 'sales-chart__label--peak' : ''}`}>
                {i === peakIndex && period === 'today' ? `${p.label} (Peak)` : p.label}
              </text>
            ))}

            <rect x={PAD.left} y={0} width={innerW} height={baseline} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
          </svg>
        )}
        {width > 0 && (
          <div className="sales-chart__tip" style={{ left: tipLeft, top: y(points[active].value) - 12 }} role="status">
            <span>
              {points[active].label}
              {active === peakIndex && period === 'today' ? ' Rush' : ''}
            </span>
            <strong>{formatPeso(points[active].value)}</strong>
          </div>
        )}
      </div>
    </section>
  );
}
