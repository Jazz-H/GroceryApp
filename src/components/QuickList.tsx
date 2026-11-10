import { useMemo, useState } from 'react';
import { formatCents } from '../lib/money';
import { quickEntries, type QuickEntry } from '../lib/quickList';
import { storeDef } from '../lib/stores';
import type { CatalogEntry, Item, StoreId } from '../types';

/** One-tap re-adding: everything ever added (including imports), most-bought first. */
export function QuickList({
  catalog,
  items,
  store,
  onAdd,
}: {
  catalog: CatalogEntry[];
  items: Item[];
  store: StoreId | 'all';
  onAdd: (e: QuickEntry) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<Set<string>>(() => new Set());
  const entries = useMemo(
    () => quickEntries(catalog, items, store, query),
    [catalog, items, store, query],
  );

  async function add(e: QuickEntry) {
    setAdding((s) => new Set(s).add(e.key));
    try {
      await onAdd(e);
    } finally {
      setAdding((s) => {
        const next = new Set(s);
        next.delete(e.key);
        return next;
      });
    }
  }

  return (
    <div className="board cards quick">
      <label className="sr-only" htmlFor="quick-search">
        Search things you've bought
      </label>
      <input
        id="quick-search"
        className="quick-search"
        type="search"
        placeholder="Search things you've bought"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />
      {entries.length === 0 ? (
        <p className="empty muted">
          {catalog.length === 0
            ? 'Everything you add or import shows up here, ready to add again with one tap.'
            : 'Nothing matches.'}
        </p>
      ) : (
        <section className="card list-card" aria-label="Quick add">
          {entries.map((e) => (
            <div key={e.key} className={`it quick-it${e.onList ? ' on' : ''}`}>
              <span className="nm">
                {e.name}
                {store === 'all' && (
                  <span className="quick-store"> · {storeDef(e.store).name}</span>
                )}
              </span>
              <span className={`pr${e.cents == null ? ' none' : ''}`}>
                {e.cents == null ? '–' : formatCents(e.cents)}
              </span>
              {e.onList ? (
                <span className="quick-added" aria-label={`${e.name} is on the list`}>
                  On list
                </span>
              ) : (
                <button
                  className="quick-add"
                  aria-label={`Add ${e.name}`}
                  disabled={adding.has(e.key)}
                  onClick={() => add(e)}
                >
                  +
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
