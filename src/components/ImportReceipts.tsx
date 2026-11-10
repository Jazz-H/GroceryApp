import { useEffect, useState } from 'react';
import { saveReceipt, updateReceipts } from '../data/receipts';
import { formatCents } from '../lib/money';
import {
  decodeReceiptsHash,
  findSaved,
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
  receipts: Receipt[];
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
  const rows = drafts.map((d) => {
    const saved = findSaved(d, receipts);
    const patch = saved ? receiptPatch(d, saved) : null;
    const fix = saved && patch ? { saved, patch } : null;
    return { d, saved, fix };
  });
  const fresh = rows.filter((r) => !r.saved).map((r) => r.d);
  const fixes = rows.filter((r) => r.fix);
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
      const parts = [];
      if (fresh.length)
        parts.push(
          `Added ${fresh.length} ${fresh.length === 1 ? 'receipt' : 'receipts'} (${formatCents(total)})`,
        );
      if (fixes.length)
        parts.push(`updated ${fixes.length} saved ${fixes.length === 1 ? 'receipt' : 'receipts'}`);
      if (priced) parts.push(`updated ${priced} ${priced === 1 ? 'price' : 'prices'}`);
      const msg = parts.join(', ');
      const latest = Math.max(...[...fresh, ...fixes.map((f) => f.d)].map((d) => d.purchasedAt));
      setDrafts(null);
      onDone(msg.charAt(0).toUpperCase() + msg.slice(1) + '.', monthKey(latest));
    } catch {
      setError('Couldn’t save the receipts. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card import-receipts" role="region" aria-labelledby="import-receipts-title">
      <h2 id="import-receipts-title">
        {fresh.length
          ? `Add ${fresh.length} past ${fresh.length === 1 ? 'receipt' : 'receipts'}?`
          : fixes.length
            ? `Update ${fixes.length} saved ${fixes.length === 1 ? 'receipt' : 'receipts'}?`
            : 'Already added'}
      </h2>
      <ul className="import-receipts-list">
        {rows.map(({ d, saved, fix }, i) => {
          const dup = !!saved && !fix;
          // Only list what will change once there's something to change.
          if (dup && (fresh.length || fixes.length)) return null;
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
                  {dup && ' · already saved'}
                </span>
              </span>
              <span className="mono">{formatCents(d.totalCents)}</span>
            </li>
          );
        })}
      </ul>
      {(fresh.length > 0 || fixes.length > 0) && rows.length > fresh.length + fixes.length && (
        <p className="muted">
          {rows.length - fresh.length - fixes.length} more already saved and up to date.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row-actions">
        {(fresh.length > 0 || fixes.length > 0) && (
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy
              ? 'Saving…'
              : fresh.length
                ? `Add ${formatCents(total)}`
                : `Update ${fixes.length}`}
          </button>
        )}
        <button className="btn ghost" onClick={() => setDrafts(null)} disabled={busy}>
          {fresh.length || fixes.length ? 'Not now' : 'Close'}
        </button>
      </div>
    </div>
  );
}
