import { useState } from 'react';
import { formatCents } from '../lib/money';
import { monthKey, monthLabel, monthRecap, receiptStoreName, shiftMonth } from '../lib/receipts';
import type { Household, Receipt } from '../types';

const KEY = 'fb.recapSeen';

function seen(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/** Last month in one card, shown for the first week of a new month until dismissed. */
export function RecapCard({
  household,
  receipts,
  onOpen,
}: {
  household: Household;
  receipts: Receipt[];
  onOpen: (month: string) => void;
}) {
  const now = new Date();
  const last = shiftMonth(monthKey(now.getTime()), -1);
  const [hidden, setHidden] = useState(() => seen() === last);
  if (hidden || now.getDate() > 7) return null;
  const r = monthRecap(receipts, last);
  if (r.cents <= 0) return null;
  const budget = household.budgetCents;
  const name = monthLabel(last).split(' ')[0];

  function dismiss() {
    try {
      localStorage.setItem(KEY, last);
    } catch {
      /* private mode: it just shows again next time */
    }
    setHidden(true);
  }

  return (
    <div className="card recap" role="region" aria-label={`${name} recap`}>
      <div className="recap-head">
        <h2>{name} recap</h2>
        <button className="btn link small" onClick={dismiss} aria-label="Dismiss recap">
          ✕
        </button>
      </div>
      <div className="recap-big mono">{formatCents(r.cents)}</div>
      <p className="muted">
        {r.receipts} {r.receipts === 1 ? 'receipt' : 'receipts'}
        {r.topStore && ` · most at ${receiptStoreName(r.topStore)} (${formatCents(r.topCents)})`}
        {budget
          ? r.cents > budget
            ? ` · ${formatCents(r.cents - budget)} over budget`
            : ` · ${formatCents(budget - r.cents)} under budget`
          : ''}
      </p>
      <div className="row-actions">
        <button className="btn ghost small" onClick={() => onOpen(last)}>
          See {name}
        </button>
      </div>
    </div>
  );
}
