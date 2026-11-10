import { useMemo, useState } from 'react';
import { useSettlements } from '../data/hooks';
import { recordSettlement, undoSettlement } from '../data/settle';
import { formatCents } from '../lib/money';
import { balances } from '../lib/settle';
import type { Household, Receipt } from '../types';
import { Avatar } from './ui';

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
              <button className="btn primary" onClick={settle} disabled={busy}>
                {busy ? 'Saving…' : 'Yes, settled'}
              </button>
              <button className="btn ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="row-actions">
              <button className="btn ghost" onClick={() => setConfirming(true)}>
                Mark as paid back
              </button>
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
              <button className="btn ghost" onClick={() => setJustSettled(false)}>
                Done
              </button>
              <button className="btn link" onClick={() => undoSettlement(household.id, last.id)}>
                Undo
              </button>
            </div>
          </>
        )
      )}
    </div>
  );
}
