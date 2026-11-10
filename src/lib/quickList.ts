import type { CatalogEntry, Item, StoreId } from '../types';
import { normalizeName } from './text';
import { catalogKey } from './usuals';

export interface QuickEntry {
  key: string;
  name: string;
  /** Store to add it at: the filter's store, or where it was bought most recently. */
  store: StoreId;
  /** Last known price at that store, in cents. */
  cents: number | null;
  /** Already open on the grocery list. */
  onList: boolean;
  count: number;
}

/**
 * Everything the household has ever added (imports included), for one-tap re-adding.
 * Most-bought first, then A–Z. A store filter keeps only things bought at that store.
 */
export function quickEntries(
  catalog: CatalogEntry[],
  items: Item[],
  store: StoreId | 'all',
  query = '',
): QuickEntry[] {
  const open = new Set(
    items
      .filter((i) => i.list === 'grocery' && i.status !== 'checked')
      .map((i) => catalogKey(i.name)),
  );
  const q = normalizeName(query);
  return catalog
    .filter((c) => c.key && c.name)
    .filter((c) => store === 'all' || c.stores.includes(store))
    .filter((c) => !q || normalizeName(c.name).includes(q))
    .map((c) => {
      const at: StoreId = store === 'all' ? (c.stores[0] ?? 'target') : store;
      return {
        key: c.key,
        name: c.name,
        store: at,
        cents: c.storeInfo[at]?.price?.cents ?? null,
        onList: open.has(c.key),
        count: c.count,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
