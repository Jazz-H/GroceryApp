import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { addItems } from '../data/items';
import { ClearImported } from './ClearImported';
import { decodeImportHash, parseImport, MAX_IMPORT } from '../lib/importList';
import { formatCents } from '../lib/money';
import { STORES, storeDef } from '../lib/stores';
import { notify } from '../push';
import type { Household, Item, ListId, StoreId } from '../types';

export function ImportItems({
  household,
  uid,
  items,
}: {
  household: Household;
  uid: string;
  items: Item[];
}) {
  // An import link (#import=...) prefills the box; the hash is cleared so it isn't reused.
  const [text, setText] = useState(() => decodeImportHash(location.hash) ?? '');
  const fromLink = useRef(text.length > 0);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const apply = () => {
      const fromHash = decodeImportHash(location.hash);
      if (!fromHash) return;
      fromLink.current = true;
      setText(fromHash);
      history.replaceState(null, '', '#settings');
      cardRef.current?.scrollIntoView({ block: 'start' });
    };
    if (fromLink.current) {
      history.replaceState(null, '', '#settings');
      cardRef.current?.scrollIntoView({ block: 'start' });
    }
    // A link opened while Settings is already showing only changes the hash.
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);
  const [store, setStore] = useState<StoreId>('target');
  const [list, setList] = useState<ListId>('grocery');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const parsed = useMemo(() => parseImport(text, store), [text, store]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500_000) {
      setMessage('That file is too big. Import up to 100 items at a time.');
      return;
    }
    setText(await file.text());
    setMessage(null);
    e.target.value = '';
  }

  async function run() {
    if (!parsed.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const { added, skipped } = await addItems(household.id, uid, parsed, {
        list,
        store,
        existing: items,
      });
      setMessage(
        `Added ${added.length} ${added.length === 1 ? 'item' : 'items'}` +
          (skipped.length ? `. Skipped ${skipped.length} already on the list.` : '.'),
      );
      if (added.length) {
        setText('');
        // Only the grocery list is worth a heads-up, same as adding from the list.
        if (list === 'grocery')
          void notify(household.id, 'adds', { items: added.slice(0, 20), count: added.length });
      }
    } catch (e) {
      setMessage(`Couldn’t import: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" ref={cardRef}>
      <h2>Import items</h2>
      {fromLink.current && text && (
        <p className="hint">Filled in from your import link. Check the preview, then tap Add.</p>
      )}
      <p className="muted">
        Paste a list (one item per line, an optional price at the end, like “Bananas, 0.29”) or
        choose a CSV file with a <code>name</code> column and optional <code>price</code>,{' '}
        <code>qty</code>, <code>store</code> and <code>note</code> columns. Up to {MAX_IMPORT} at a
        time.
      </p>
      <label htmlFor="import-text">
        Items
        <textarea
          id="import-text"
          className="import-text"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Bananas, 0.29\nSour cream 16oz, 1.99\n2 Campbell’s tomato soup, 1.29'}
        />
      </label>
      <div className="row-actions">
        <label className="file-btn btn ghost" htmlFor="import-file">
          Choose file
          <input
            id="import-file"
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            onChange={onFile}
          />
        </label>
        <label htmlFor="import-store" className="inline-label">
          Store
          <select
            id="import-store"
            value={store}
            onChange={(e) => setStore(e.target.value as StoreId)}
          >
            {STORES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="import-list" className="inline-label">
          List
          <select id="import-list" value={list} onChange={(e) => setList(e.target.value as ListId)}>
            <option value="grocery">Grocery</option>
            <option value="nice">Nice-to-have</option>
          </select>
        </label>
      </div>
      {parsed.length > 0 && (
        <div className="import-preview" aria-live="polite">
          <p className="label">Preview · {parsed.length} items</p>
          <ul>
            {parsed.slice(0, 8).map((p, i) => (
              <li key={`${p.name}-${i}`}>
                <span>
                  {p.qty > 1 ? `${p.qty} × ` : ''}
                  {p.name}
                </span>
                <span className="mono muted">
                  {p.store && p.store !== store ? `${storeDef(p.store).short} · ` : ''}
                  {p.priceCents != null ? formatCents(p.priceCents) : '–'}
                </span>
              </li>
            ))}
            {parsed.length > 8 && <li className="muted">and {parsed.length - 8} more</li>}
          </ul>
        </div>
      )}
      <div className="row-actions">
        <button className="btn primary" onClick={run} disabled={busy || !parsed.length}>
          {busy
            ? 'Adding…'
            : `Add ${parsed.length || ''} to ${list === 'grocery' ? 'Grocery' : 'Nice-to-have'}`}
        </button>
      </div>
      {message && <p className="hint">{message}</p>}
      <ClearImported household={household} uid={uid} items={items} />
    </div>
  );
}
