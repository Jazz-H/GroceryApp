import { useState } from 'react';
import { bulkAddedIds, deleteItems } from '../data/items';
import { storeDef } from '../lib/stores';
import type { Household, Item } from '../types';
import { Sheet } from './ui';

/**
 * Removes items that came in through an import from the lists. They stay in the catalog, so
 * the Quick add tab can put any of them back with one tap.
 */
export function ClearImported({
  household,
  uid,
  items,
}: {
  household: Household;
  uid: string;
  items: Item[];
}) {
  const [found, setFound] = useState<Item[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function look() {
    setBusy(true);
    setMessage(null);
    try {
      const ids = await bulkAddedIds(household.id);
      const list = items
        .filter((i) => ids.has(i.id))
        .sort((a, b) => a.list.localeCompare(b.list) || a.name.localeCompare(b.name));
      if (!list.length) setMessage('No imported items are on your lists.');
      else {
        setFound(list);
        setPicked(new Set(list.map((i) => i.id)));
      }
    } catch {
      setMessage('Couldn’t look up imported items. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!found) return;
    setBusy(true);
    try {
      const chosen = found.filter((i) => picked.has(i.id));
      // 3 writes per item; stay under Firestore's 500 per batch.
      for (let i = 0; i < chosen.length; i += 150)
        await deleteItems(household.id, uid, chosen.slice(i, i + 150));
      setFound(null);
      setMessage(
        `Removed ${chosen.length} ${chosen.length === 1 ? 'item' : 'items'}. They're still in Quick add.`,
      );
    } catch {
      setMessage('Couldn’t remove them. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className="row-actions">
        <button className="btn ghost" onClick={look} disabled={busy}>
          {busy && !found ? 'Looking…' : 'Remove imported items from the list…'}
        </button>
      </div>
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}
      {found && (
        <Sheet
          onClose={() => setFound(null)}
          labelledBy="ci-title"
          title={
            <h2 id="ci-title" className="sheet-title-plain">
              Remove imported items
            </h2>
          }
        >
          <p className="muted">
            {found.length} {found.length === 1 ? 'item' : 'items'} came in from an import. Untick
            any you want to keep. Removed items stay in Quick add.
          </p>
          <div className="row-actions">
            <button className="btn link" onClick={() => setPicked(new Set(found.map((i) => i.id)))}>
              Select all
            </button>
            <button className="btn link" onClick={() => setPicked(new Set())}>
              Select none
            </button>
          </div>
          <ul className="clear-list">
            {found.map((i) => (
              <li key={i.id}>
                <label className="check-label">
                  <input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i.id)} />
                  <span>
                    {i.name}
                    <span className="muted">
                      {' '}
                      · {i.list === 'nice' ? 'Nice-to-have' : 'Grocery'}
                      {i.stores[0] ? ` · ${storeDef(i.stores[0]).name}` : ''}
                      {i.status === 'checked' ? ' · checked' : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="row-actions">
            <button className="btn danger" onClick={remove} disabled={busy || picked.size === 0}>
              {busy ? 'Removing…' : `Remove ${picked.size}`}
            </button>
            <button className="btn ghost" onClick={() => setFound(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
