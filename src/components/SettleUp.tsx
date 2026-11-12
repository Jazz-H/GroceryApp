import { useMemo, useState } from 'react';
import { useSettlements } from '../data/hooks';
import { recordSettlement, undoSettlement } from '../data/settle';
import { formatCents } from '../lib/money';
import { balances } from '../lib/settle';
import type { Household, Receipt } from '../types';
import { Avatar, Sheet } from './ui';
import { Button } from './ui/button';

/**
 * Who's paid more for shared groceries, split equally, and a button to mark it paid back.
 * Counts every receipt ever saved, minus settle-ups already recorded. Hidden when nobody owes
 * anything, except right after marking a settle-up, so it can be undone.
 */
export function SettleUp({
  household,
  uid,
  receipts,
}: {
  household: Household;
  uid: string;
  receipts: Receipt[];
}) {
  const settlements = useSettlements(household.id);
  const balance = useMemo(
    () => balances(receipts, settlements, household.memberIds),
    [receipts, settlements, household.memberIds],
  );
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Just marked as paid back here: keep the card up with Undo until dismissed.
  const [justSettled, setJustSettled] = useState(false);
  const name = (id: string) => household.members[id]?.name?.split(/\s+/)[0] ?? 'Someone';

  if (household.memberIds.length < 2) return null;
  const owed = balance.transfers[0];
  const last = settlements[0];
  if (!owed && !(justSettled && last)) return null;

  async function settle() {
    if (!owed) return;
    setBusy(true);
    try {
      await recordSettlement(household.id, uid, owed.from, owed.to, owed.cents);
      setConfirming(false);
      setJustSettled(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card settle">
      <h2>Settle up</h2>
      {owed ? (
        <>
          <div className="settle-line">
            <Avatar member={household.members[owed.from]} size={28} />
            <span>
              <b>{name(owed.from)}</b> owes <b>{name(owed.to)}</b>
            </span>
            <span className="settle-amount mono">{formatCents(owed.cents)}</span>
          </div>
          <p className="muted">
            Groceries split evenly. {name(owed.to)} has paid {formatCents(owed.cents * 2)} more in
            total{last ? ' since the last settle-up' : ''}.
          </p>
          {confirming ? (
            <div className="row-actions">
              <span className="muted">
                Did {name(owed.from)} pay {name(owed.to)} {formatCents(owed.cents)}?
              </span>
              <Button onClick={settle} disabled={busy}>
                {busy ? 'Saving…' : 'Yes, settled'}
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="row-actions">
              <Button variant="secondary" onClick={() => setConfirming(true)}>
                Mark as paid back
              </Button>
            </div>
          )}
        </>
      ) : (
        last && (
          <>
            <p className="muted">
              Settled: {name(last.from)} paid {name(last.to)} {formatCents(last.cents)}. You’re all
              square.
            </p>
            <div className="row-actions">
              <Button variant="secondary" onClick={() => setJustSettled(false)}>
                Done
              </Button>
              <Button
                variant="link"
                size="inline"
                onClick={() => undoSettlement(household.id, last.id)}
              >
                Undo
              </Button>
            </div>
          </>
        )
      )}
    </div>
  );
}

/** Every settle-up recorded, newest first, each removable (for a mistake or a test). */
export function SettleHistory({
  household,
  onClose,
}: {
  household: Household;
  onClose: () => void;
}) {
  const settlements = useSettlements(household.id);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = (id: string) => household.members[id]?.name?.split(/\s+/)[0] ?? 'Someone';

  async function remove(id: string) {
    setBusy(true);
    try {
      await undoSettlement(household.id, id);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      onClose={onClose}
      labelledBy="settle-history-title"
      title={
        <h2 id="settle-history-title" className="sheet-title-plain">
          Settle-up history
        </h2>
      }
    >
      {settlements.length === 0 ? (
        <p className="muted">No settle-ups recorded.</p>
      ) : (
        <>
          <p className="muted">Removing a settle-up puts that amount back into who owes whom.</p>
          <ul className="report-list settle-history">
            {settlements.map((s) => (
              <li key={s.id}>
                {confirm === s.id ? (
                  <>
                    <span>
                      Remove {name(s.from)} → {name(s.to)} {formatCents(s.cents)}?
                    </span>
                    <span className="row-actions">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => remove(s.id)}
                        disabled={busy}
                      >
                        {busy ? 'Removing…' : 'Remove'}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setConfirm(null)}>
                        Keep
                      </Button>
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      <b>{name(s.from)}</b> paid <b>{name(s.to)}</b>{' '}
                      <span className="mono">{formatCents(s.cents)}</span>
                      <span className="muted">
                        {' '}
                        ·{' '}
                        {new Date(s.at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </span>
                    <Button
                      variant="destructive-link"
                      size="sm"
                      aria-label={`Remove ${name(s.from)} paid ${name(s.to)} ${formatCents(s.cents)}`}
                      onClick={() => setConfirm(s.id)}
                    >
                      Remove
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="sheet-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Sheet>
  );
}
