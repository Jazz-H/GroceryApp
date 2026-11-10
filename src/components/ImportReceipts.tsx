import { useEffect, useState } from 'react';
import { deleteReceipt, saveReceipt, updateReceipts } from '../data/receipts';
import { formatCents } from '../lib/money';
import {
  decodeReceiptsHash,
  findAllSaved,
  pickKeeper,
  receiptPatch,
  type LinkReceipt,
} from '../lib/receiptImport';
import { cardsLabel, matchAll, monthKey, receiptStoreName } from '../lib/receipts';
import type { Household, Item, Receipt } from '../types';

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/**
 * A receipt link (#receipts=...) shows its receipts here to confirm before saving.
 * Past receipts set "paid" prices on matching items but never check anything off.
 * When the link says who paid, receipts already saved get that payer too.
 */
export function ImportReceipts({
  household,
  uid,
  items,
  receipts,
  aliases,
  onDone,
}: {
  household: Household;
  uid: string;
  items: Item[];
  /** Null until saved receipts have loaded: nothing can be compared before then. */
  receipts: Receipt[] | null;
  aliases: Map<string, string>;
  onDone: (message: string, month?: string) => void;
}) {
  const members = household.members;
  const [drafts, setDrafts] = useState<LinkReceipt[] | null>(() =>
    decodeReceiptsHash(location.hash, uid, members),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (/^#receipts=/.test(location.hash)) history.replaceState(null, '', '#spend');
    // A link opened while Spend is already showing only changes the hash.
    const apply = () => {
      const fromHash = decodeReceiptsHash(location.hash, uid, members);
      if (!fromHash) return;
      setDrafts(fromHash);
      history.replaceState(null, '', '#spend');
    };
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [uid, members]);

  if (!drafts) return null;
  if (!receipts)
    return (
      <div className="card import-receipts" role="status">
        <h2>Checking what’s already saved…</h2>
      </div>
    );
  const rows = drafts.map((d) => {
    const copies = findAllSaved(d, receipts);
    const { keep: saved, extra } = copies.length
      ? pickKeeper(copies)
      : { keep: undefined, extra: [] as Receipt[] };
    const patch = saved ? receiptPatch(d, saved) : null;
    const fix = saved && patch ? { saved, patch } : null;
    return { d, saved, fix, extra };
  });
  const fresh = rows.filter((r) => !r.saved).map((r) => r.d);
  const fixes = rows.filter((r) => r.fix);
  const dupes = rows.flatMap((r) => r.extra);
  const total = fresh.reduce((sum, d) => sum + d.totalCents, 0);
  const name = (id: string) => members[id]?.name?.split(/\s+/)[0] ?? 'Member';

  async function save() {
    setBusy(true);
    setError(null);
    try {
      let priced = 0;
      for (const { linkPayer: _payer, ...d } of fresh) {
        const { draft } = matchAll(d, items, aliases);
        const r = await saveReceipt(household.id, uid, draft, items, { checkOff: false });
        priced += r.priced;
      }
      // Receipts already saved get the link's payer and cards.
      await updateReceipts(
        household.id,
        fixes.map(({ fix }) => ({ id: fix!.saved.id, patch: fix!.patch })),
      );
      // Extra copies of the same receipt (same store, day and total) are removed.
      for (const r of dupes) await deleteReceipt(household.id, r);
      const parts = [];
      if (fresh.length)
        parts.push(
          `Added ${fresh.length} ${fresh.length === 1 ? 'receipt' : 'receipts'} (${formatCents(total)})`,
        );
      if (fixes.length)
        parts.push(`updated ${fixes.length} saved ${fixes.length === 1 ? 'receipt' : 'receipts'}`);
      if (dupes.length)
        parts.push(`removed ${dupes.length} duplicate${dupes.length === 1 ? '' : 's'}`);
      if (priced) parts.push(`updated ${priced} ${priced === 1 ? 'price' : 'prices'}`);
      const msg = parts.join(', ');
      const touched = [...fresh, ...fixes.map((f) => f.d)];
      const latest = touched.length ? Math.max(...touched.map((d) => d.purchasedAt)) : undefined;
      setDrafts(null);
      onDone(
        msg.charAt(0).toUpperCase() + msg.slice(1) + '.',
        latest ? monthKey(latest) : undefined,
      );
    } catch {
      setError('Couldn’t save the receipts. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const changes = fresh.length + fixes.length + dupes.length;
  const summary = [
    fresh.length && `add ${fresh.length} past ${fresh.length === 1 ? 'receipt' : 'receipts'}`,
    fixes.length && `update ${fixes.length} saved ${fixes.length === 1 ? 'receipt' : 'receipts'}`,
    dupes.length && `remove ${dupes.length} duplicate${dupes.length === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(', ');
  const unchanged = rows.filter((r) => r.saved && !r.fix && !r.extra.length).length;

  return (
    <div className="card import-receipts" role="region" aria-labelledby="import-receipts-title">
      <h2 id="import-receipts-title">
        {changes ? summary.charAt(0).toUpperCase() + summary.slice(1) + '?' : 'Already added'}
      </h2>
      <ul className="import-receipts-list">
        {rows.map(({ d, saved, fix, extra }, i) => {
          const dup = !!saved && !fix && !extra.length;
          // Only list what will change once there's something to change.
          if (dup && changes) return null;
          return (
            <li key={i} className={dup ? 'dup' : undefined}>
              <span>
                <b>{d.kind === 'tip' ? 'Shopper tip' : receiptStoreName(d.store)}</b>
                <span className="muted">
                  {' '}
                  {dateFmt.format(d.purchasedAt)}
                  {d.lines.length > 0 &&
                    ` · ${d.lines.length} ${d.lines.length === 1 ? 'item' : 'items'}`}
                  {cardsLabel(d) && ` · ${cardsLabel(d)}`}
                  {d.linkPayer && ` · ${name(d.linkPayer)}`}
                  {fix?.patch.paidBy && ` (was ${name(fix.saved.paidBy)})`}
                  {extra.length > 0 &&
                    ` · ${extra.length} duplicate${extra.length === 1 ? '' : 's'} removed`}
                  {dup && ' · already saved'}
                </span>
              </span>
              <span className="mono">{formatCents(d.totalCents)}</span>
            </li>
          );
        })}
      </ul>
      {changes > 0 && unchanged > 0 && (
        <p className="muted">{unchanged} more already saved and up to date.</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row-actions">
        {changes > 0 && (
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : fresh.length ? `Add ${formatCents(total)}` : 'Update'}
          </button>
        )}
        <button className="btn ghost" onClick={() => setDrafts(null)} disabled={busy}>
          {changes ? 'Not now' : 'Close'}
        </button>
      </div>
    </div>
  );
}
