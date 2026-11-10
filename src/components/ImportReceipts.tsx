import { useEffect, useState } from 'react';
import { saveReceipt } from '../data/receipts';
import { formatCents } from '../lib/money';
import { decodeReceiptsHash, isDuplicate } from '../lib/receiptImport';
import { matchAll, monthKey, receiptStoreName, type ReceiptDraft } from '../lib/receipts';
import type { Household, Item, Receipt } from '../types';

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

/**
 * A receipt link (#receipts=...) shows its receipts here to confirm before saving.
 * Past receipts set "paid" prices on matching items but never check anything off.
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
  const [drafts, setDrafts] = useState<ReceiptDraft[] | null>(() =>
    decodeReceiptsHash(location.hash, uid),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (/^#receipts=/.test(location.hash)) history.replaceState(null, '', '#spend');
    // A link opened while Spend is already showing only changes the hash.
    const apply = () => {
      const fromHash = decodeReceiptsHash(location.hash, uid);
      if (!fromHash) return;
      setDrafts(fromHash);
      history.replaceState(null, '', '#spend');
    };
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [uid]);

  if (!drafts) return null;
  const fresh = drafts.filter((d) => !isDuplicate(d, receipts));
  const total = fresh.reduce((sum, d) => sum + d.totalCents, 0);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      let priced = 0;
      for (const d of fresh) {
        const { draft } = matchAll(d, items, aliases);
        const r = await saveReceipt(household.id, uid, draft, items, { checkOff: false });
        priced += r.priced;
      }
      const latest = Math.max(...fresh.map((d) => d.purchasedAt));
      setDrafts(null);
      onDone(
        `Added ${fresh.length} ${fresh.length === 1 ? 'receipt' : 'receipts'} (${formatCents(total)})` +
          (priced ? `. Updated ${priced} ${priced === 1 ? 'price' : 'prices'}.` : '.'),
        monthKey(latest),
      );
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
          : 'Already added'}
      </h2>
      <ul className="import-receipts-list">
        {drafts.map((d, i) => {
          const dup = isDuplicate(d, receipts);
          return (
            <li key={i} className={dup ? 'dup' : undefined}>
              <span>
                <b>{receiptStoreName(d.store)}</b>
                <span className="muted">
                  {' '}
                  {dateFmt.format(d.purchasedAt)} · {d.lines.length}{' '}
                  {d.lines.length === 1 ? 'item' : 'items'}
                  {dup && ' · already saved'}
                </span>
              </span>
              <span className="mono">{formatCents(d.totalCents)}</span>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row-actions">
        {fresh.length > 0 && (
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? 'Adding…' : `Add ${formatCents(total)}`}
          </button>
        )}
        <button className="btn ghost" onClick={() => setDrafts(null)} disabled={busy}>
          {fresh.length ? 'Not now' : 'Close'}
        </button>
      </div>
    </div>
  );
}
