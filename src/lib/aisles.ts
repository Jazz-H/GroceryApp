import type { Item, StoreId } from '../types';
import { categoryOf, zoneForCategory } from './categories';
import { AISLES_TOKEN, STORES } from './stores';

/** Sort key for items whose aisle is a named zone that isn't in the zone order. */
const UNKNOWN_ZONE = 900_000;

/**
 * Turns an aisle label into a number that sorts in walking order.
 *
 * - Empty: Infinity, so the item lands in "Not placed yet".
 * - A named zone ("Produce"): its position in the store's zone order.
 * - A numbered aisle ("7", "Aisle 7") or a letter + number ("G14", Target style):
 *   placed where the `Aisles` token sits in the zone order, sorted by letter then number.
 */
export function aisleSortKey(label: string | undefined, zoneOrder: string[] = []): number {
  const raw = (label ?? '').trim();
  if (!raw) return Infinity;
  const lower = raw.toLowerCase();

  const zoneIndex = zoneOrder.findIndex((z) => z.toLowerCase() === lower);
  if (zoneIndex >= 0 && zoneOrder[zoneIndex] !== AISLES_TOKEN) return zoneIndex * 10_000;

  const m = /^(?:aisle\s*)?([a-z]?)\s*(\d{1,3})([a-z]?)$/i.exec(raw);
  if (m) {
    const tokenIndex = zoneOrder.indexOf(AISLES_TOKEN);
    const base = (tokenIndex >= 0 ? tokenIndex : zoneOrder.length) * 10_000;
    const letter = m[1] ? m[1].toUpperCase().charCodeAt(0) - 64 : 0; // A=1 … Z=26
    const suffix = m[3] ? (m[3].toUpperCase().charCodeAt(0) - 64) / 100 : 0; // 12B after 12A
    return base + letter * 1_000 + Number(m[2]) + suffix;
  }
  return UNKNOWN_ZONE;
}

/** Display label: "7" → "Aisle 7", "g14" → "Aisle G14", "produce" → "Produce". */
export function aisleLabel(label: string | undefined): string {
  const raw = (label ?? '').trim();
  if (!raw) return '';
  const m = /^(?:aisle\s*)?([a-z]?\s*\d{1,3}[a-z]?)$/i.exec(raw);
  if (m) return `Aisle ${m[1].replace(/\s+/g, '').toUpperCase()}`;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export type BoardRow =
  | { type: 'store'; store: StoreId; label: string }
  | { type: 'aisle'; label: string }
  | { type: 'item'; item: Item; store: StoreId };

export interface BoardOptions {
  /** Store pill selected, or 'all'. */
  store: StoreId | 'all';
  /** Whether the Aisle order pill is on. */
  sortByAisle: boolean;
  zoneOrder: Partial<Record<StoreId, string[]>>;
}

export const NOT_PLACED = 'Not placed yet';
/** Heading for items in a placed pickup order. Always last on the board. */
export const ORDERED = 'Ordered for pickup';

/** The store whose price and aisle an item shows in the current view. */
export function viewStore(item: Item, store: StoreId | 'all'): StoreId {
  return store === 'all' ? item.stores[0] : store;
}

export function itemsInView(items: Item[], store: StoreId | 'all'): Item[] {
  return store === 'all' ? items : items.filter((i) => i.stores.includes(store));
}

function byCreated(a: Item, b: Item) {
  return a.createdAt - b.createdAt || a.name.localeCompare(b.name);
}

/**
 * The aisle an item sorts under at a store: the one typed in, else the zone its category is
 * shelved in when the store has that zone (spinach → Produce), else none.
 */
export function placedAisle(item: Item, store: StoreId, zoneOrder: string[]): string | undefined {
  return (
    item.storeInfo[store]?.aisle?.label || zoneForCategory(categoryOf(item), zoneOrder) || undefined
  );
}

function aisleRows(items: Item[], store: StoreId, zoneOrder: string[]): BoardRow[] {
  const keyed = items.map((item) => {
    const label = placedAisle(item, store, zoneOrder);
    return { item, label, key: aisleSortKey(label, zoneOrder) };
  });
  keyed.sort(
    (a, b) =>
      a.key - b.key ||
      aisleLabel(a.label).localeCompare(aisleLabel(b.label)) ||
      a.item.name.localeCompare(b.item.name),
  );
  const rows: BoardRow[] = [];
  let current: string | null = null;
  for (const { item, label } of keyed) {
    const heading = aisleLabel(label) || NOT_PLACED;
    if (heading !== current) {
      rows.push({ type: 'aisle', label: heading });
      current = heading;
    }
    rows.push({ type: 'item', item, store });
  }
  return rows;
}

/** Lays out the board: the rows to draw, in order, for the current pills. */
export function buildBoard(items: Item[], opts: BoardOptions): BoardRow[] {
  const inView = itemsInView(items, opts.store);
  const ordered = inView.filter((i) => i.status === 'ordered');
  const rows = layout(
    inView.filter((i) => i.status !== 'ordered'),
    opts,
  );
  if (ordered.length) {
    rows.push({ type: 'aisle', label: ORDERED });
    for (const item of [...ordered].sort(byCreated))
      rows.push({ type: 'item', item, store: viewStore(item, opts.store) });
  }
  return rows;
}

function layout(visible: Item[], opts: BoardOptions): BoardRow[] {
  if (!opts.sortByAisle) {
    return [...visible].sort(byCreated).map((item) => ({
      type: 'item' as const,
      item,
      store: viewStore(item, opts.store),
    }));
  }
  if (opts.store !== 'all') {
    return aisleRows(visible, opts.store, opts.zoneOrder[opts.store] ?? []);
  }
  const rows: BoardRow[] = [];
  for (const s of STORES) {
    const part = visible.filter((i) => i.stores[0] === s.id);
    if (!part.length) continue;
    rows.push({ type: 'store', store: s.id, label: s.name });
    if (s.hasAisles) rows.push(...aisleRows(part, s.id, opts.zoneOrder[s.id] ?? []));
    else
      rows.push(
        ...[...part].sort(byCreated).map((item) => ({ type: 'item' as const, item, store: s.id })),
      );
  }
  return rows;
}
