import { formatCents } from '../lib/money';
import { receiptStoreName, type PricePoint, type PriceTrend } from '../lib/receipts';
import type { ReceiptStore } from '../types';

const COLORS: Record<ReceiptStore, string> = {
  target: '#ff8a80',
  ht: '#6fd39b',
  amazon: '#ffcf66',
  other: '#9dbbff',
};

const W = 300;
const H = 90;
const PAD = 8;

/** A small line per store of the unit price paid over time. */
export function PriceChart({ points, trends }: { points: PricePoint[]; trends: PriceTrend[] }) {
  if (points.length < 2) return null;
  const xs = points.map((p) => p.at);
  const ys = points.map((p) => p.unitCents);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const x = (t: number) => PAD + ((t - x0) / Math.max(1, x1 - x0)) * (W - 2 * PAD);
  // Flat prices sit in the middle instead of on the floor.
  const y = (c: number) => (y1 === y0 ? H / 2 : H - PAD - ((c - y0) / (y1 - y0)) * (H - 2 * PAD));

  const stores = [...new Set(points.map((p) => p.store))];
  const label = (t: number) =>
    new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <figure className="price-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Prices paid from ${label(x0)} to ${label(x1)}, between ${formatCents(y0)} and ${formatCents(y1)}`}
      >
        {stores.map((s) => {
          const mine = points.filter((p) => p.store === s).sort((a, b) => a.at - b.at);
          return (
            <g key={s} stroke={COLORS[s]} fill={COLORS[s]}>
              {mine.length > 1 && (
                <polyline
                  fill="none"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={mine.map((p) => `${x(p.at)},${y(p.unitCents)}`).join(' ')}
                />
              )}
              {mine.map((p, i) => (
                <circle key={i} cx={x(p.at)} cy={y(p.unitCents)} r="3.5" stroke="none" />
              ))}
            </g>
          );
        })}
      </svg>
      <figcaption>
        <span className="muted">
          {label(x0)} – {label(x1)} · {formatCents(y0)}
          {y1 !== y0 ? `–${formatCents(y1)}` : ''}
        </span>
        <span className="chart-legend">
          {stores.map((s) => (
            <span key={s}>
              <i style={{ background: COLORS[s] }} aria-hidden="true" />
              {receiptStoreName(s)}
            </span>
          ))}
        </span>
      </figcaption>
      {trends.map((t) => (
        <p
          key={t.store}
          className={`trend ${t.change > 0.005 ? 'up' : t.change < -0.005 ? 'down' : ''}`}
        >
          {receiptStoreName(t.store)}:{' '}
          {Math.abs(t.change) < 0.005
            ? 'same price'
            : `${t.change > 0 ? 'up' : 'down'} ${Math.round(Math.abs(t.change) * 100)}%`}{' '}
          since{' '}
          {new Date(t.since).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })} (
          {formatCents(t.firstCents)} → {formatCents(t.latestCents)})
        </p>
      ))}
    </figure>
  );
}
