import { useMemo } from 'react';
import { formatCents } from '../lib/money';
import { monthLabel, receiptStoreName } from '../lib/receipts';
import { buildReport, insights, type ReportPeriod } from '../lib/recapReport';
import type { Household, Receipt } from '../types';
import { TrendIcon } from './icons';
import { Avatar, Sheet } from './ui';
import { Button } from './ui/button';

/** A week's or month's spending as a short report with takeaways. */
export function RecapReport({
  period,
  household,
  receipts,
  onSeeMonth,
  onClose,
}: {
  period: ReportPeriod;
  household: Household;
  receipts: Receipt[];
  onSeeMonth: (month: string) => void;
  onClose: () => void;
}) {
  const r = useMemo(() => buildReport(receipts, period), [receipts, period]);
  const names = Object.fromEntries(
    Object.entries(household.members).map(([id, m]) => [id, m.name]),
  );
  const notes = insights(r, { budgetCents: household.budgetCents, names });
  const storeMax = Math.max(1, ...r.byStore.map((s) => s.cents));
  const diff = r.cents - r.prevCents;
  const monthName = monthLabel(period.month).split(' ')[0];

  return (
    <Sheet
      onClose={onClose}
      labelledBy="report-title"
      title={
        <h2 id="report-title" className="sheet-title-plain">
          {period.kind === 'week' ? period.title : `${period.title} report`}
        </h2>
      }
    >
      <div className="report">
        <div className="report-hero">
          <div className="recap-big mono">{formatCents(r.cents)}</div>
          {r.prevCents > 0 && Math.abs(diff) >= 100 && (
            <span className={`trend ${diff > 0 ? 'up' : 'down'}`}>
              <TrendIcon up={diff > 0} />
              {formatCents(Math.abs(diff))} vs {period.prevName}
            </span>
          )}
        </div>

        {r.cents <= 0 ? (
          <p className="muted">No receipts were saved for this {period.kind}.</p>
        ) : (
          <>
            <h3 className="label section-label">Takeaways</h3>
            <ul className="insights">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>

            <h3 className="label section-label">Where it went</h3>
            <ul className="bars">
              {r.byStore.map((s) => (
                <li key={s.key}>
                  <span className="bar-label">{receiptStoreName(s.key)}</span>
                  <span className="bar-track">
                    <span className="bar" style={{ width: `${(s.cents / storeMax) * 100}%` }} />
                  </span>
                  <span className="mono">{formatCents(s.cents)}</span>
                </li>
              ))}
            </ul>

            {household.memberIds.length > 1 && r.byPerson.length > 0 && (
              <>
                <h3 className="label section-label">Who paid</h3>
                <ul className="bars">
                  {r.byPerson.map((p) => {
                    const m = household.members[p.key];
                    return (
                      <li key={p.key}>
                        <span className="bar-label">
                          <Avatar member={m} size={18} /> {m?.name ?? 'Former member'}
                        </span>
                        <span className="bar-track">
                          <span
                            className="bar"
                            style={{ width: `${(p.cents / r.cents) * 100}%`, background: m?.color }}
                          />
                        </span>
                        <span className="mono">{formatCents(p.cents)}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {r.topItems.length > 0 && (
              <>
                <h3 className="label section-label">Top items</h3>
                <ul className="report-list">
                  {r.topItems.map((it) => (
                    <li key={it.name}>
                      <span>
                        {it.name}
                        {it.qty > 1 && <span className="muted"> ×{it.qty}</span>}
                      </span>
                      <span className="mono">{formatCents(it.cents)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {r.priceMoves.length > 0 && (
              <>
                <h3 className="label section-label">Price changes</h3>
                <ul className="report-list">
                  {r.priceMoves.map((m) => (
                    <li key={`${m.store}-${m.name}`}>
                      <span>
                        {m.name} <span className="muted">· {receiptStoreName(m.store)}</span>
                      </span>
                      <span className={`trend ${m.change > 0 ? 'up' : 'down'}`}>
                        <TrendIcon up={m.change > 0} />
                        <span className="mono">
                          {formatCents(m.from)} → {formatCents(m.to)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {r.topItems.length === 0 && (
              <p className="hint">
                Snap receipts with line items to see top items and price changes here.
              </p>
            )}
          </>
        )}

        <div className="sheet-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            type="button"

            onClick={() => {
              onSeeMonth(period.month);
              onClose();
            }}
          >
            See {monthName} receipts
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
