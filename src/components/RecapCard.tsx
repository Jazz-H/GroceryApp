import { useState } from 'react';
import { formatCents } from '../lib/money';
import {
  monthKey,
  monthLabel,
  monthRecap,
  receiptStoreName,
  shiftMonth,
  shiftWeek,
  weekKey,
  weekLabel,
  weekRecap,
  weekStart,
} from '../lib/receipts';
import type { Household, Receipt, ReceiptStore } from '../types';
import { CloseIcon } from './icons';

const KEYS = { month: 'fb.recapSeen', week: 'fb.weekRecapSeen' };

function seen(kind: 'week' | 'month'): string {
  try {
    return localStorage.getItem(KEYS[kind]) ?? '';
  } catch {
    return '';
  }
}

interface View {
  /** Which week or month this is, for remembering a dismissal. */
  period: string;
  title: string;
  cents: number;
  details: string[];
  /** The month to open with the button. */
  month: string;
  /** Shown without a notification tap: the first 7 days of a month, or all week. */
  inWindow: boolean;
}

const storeLine = (store: ReceiptStore | null, cents: number) =>
  store ? [`most at ${receiptStoreName(store)} (${formatCents(cents)})`] : [];
const receiptsLine = (n: number) => `${n} ${n === 1 ? 'receipt' : 'receipts'}`;

function monthView(household: Household, receipts: Receipt[], now: Date): View {
  const last = shiftMonth(monthKey(now.getTime()), -1);
  const r = monthRecap(receipts, last);
  const budget = household.budgetCents;
  return {
    period: last,
    title: `${monthLabel(last).split(' ')[0]} recap`,
    cents: r.cents,
    details: [
      receiptsLine(r.receipts),
      ...storeLine(r.topStore, r.topCents),
      ...(budget
        ? [
            r.cents > budget
              ? `${formatCents(r.cents - budget)} over budget`
              : `${formatCents(budget - r.cents)} under budget`,
          ]
        : []),
    ],
    month: last,
    inWindow: now.getDate() <= 7,
  };
}

function weekView(household: Household, receipts: Receipt[], now: Date): View {
  const start = shiftWeek(weekStart(now.getTime()), -1);
  const r = weekRecap(receipts, start);
  const month = monthKey(shiftWeek(start, 1) - 1);
  const budget = household.budgetCents;
  const diff = r.cents - r.prevCents;
  return {
    period: weekKey(start),
    title: `Last week · ${weekLabel(start)}`,
    cents: r.cents,
    details: [
      receiptsLine(r.receipts),
      ...storeLine(r.topStore, r.topCents),
      ...(r.prevCents && diff
        ? [`${formatCents(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than the week before`]
        : []),
      ...(budget
        ? [
            `${monthLabel(month).split(' ')[0]} so far: ${formatCents(
              monthRecap(receipts, month).cents,
            )} of ${formatCents(budget)}`,
          ]
        : []),
    ],
    month,
    inWindow: true,
  };
}

/**
 * Last week or last month in one card. Shows during that period's window until dismissed, and
 * always right after tapping its notification (forced).
 */
export function RecapCard({
  kind,
  household,
  receipts,
  forced = false,
  onReport,
}: {
  kind: 'week' | 'month';
  household: Household;
  receipts: Receipt[];
  forced?: boolean;
  onReport: (kind: 'week' | 'month') => void;
}) {
  const v = (kind === 'week' ? weekView : monthView)(household, receipts, new Date());
  const [hidden, setHidden] = useState(() => !forced && seen(kind) === v.period);
  if (hidden || (!forced && !v.inWindow) || v.cents <= 0) return null;

  function dismiss() {
    try {
      localStorage.setItem(KEYS[kind], v.period);
    } catch {
      /* private mode: it just shows again next time */
    }
    setHidden(true);
  }

  return (
    <div className="card recap" role="region" aria-label={v.title}>
      <div className="recap-head">
        <h2>{v.title}</h2>
        <button className="btn icon" onClick={dismiss} aria-label={`Dismiss ${v.title}`}>
          <CloseIcon />
        </button>
      </div>
      <div className="recap-big mono">{formatCents(v.cents)}</div>
      <p className="muted">{v.details.join(' · ')}</p>
      <div className="row-actions">
        <button className="btn primary" onClick={() => onReport(kind)}>
          Open report
        </button>
      </div>
    </div>
  );
}
