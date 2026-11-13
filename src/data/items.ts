import {
  collection,
  deleteField,
  doc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { createBatcher } from '../lib/activity';
import { normalizeName, type QuickAdd } from '../lib/text';
import { catalogKey, nextAddedAt } from '../lib/usuals';
import type {
  ActivityType,
  CatalogEntry,
  CategoryId,
  Item,
  ListId,
  StoreId,
  StoreInfo,
} from '../types';

const nextBatchId = createBatcher(
  () => Date.now(),
  () => crypto.randomUUID().slice(0, 8),
);

const items = (hid: string) => collection(db, 'households', hid, 'items');
const activity = (hid: string) => collection(db, 'households', hid, 'activity');
const catalog = (hid: string) => collection(db, 'households', hid, 'catalog');

/** Remembers an item's stores, prices and aisles in the catalog (kept after it's cleared). */
function rememberItem(
  batch: WriteBatch,
  hid: string,
  item: Pick<Item, 'name' | 'stores' | 'storeInfo'>,
) {
  const key = catalogKey(item.name);
  if (!key) return;
  batch.set(
    doc(catalog(hid), key),
    // increment(0) creates the count on a first write and leaves an existing one alone.
    {
      name: item.name.slice(0, 120),
      stores: item.stores,
      storeInfo: item.storeInfo,
      count: increment(0),
    },
    { merge: true },
  );
}

/** Remembers (or with null, forgets) the category you chose for a name, in the catalog. */
function rememberCategory(
  batch: WriteBatch,
  hid: string,
  name: string,
  category: CategoryId | null,
) {
  const key = catalogKey(name);
  if (!key) return;
  batch.set(
    doc(catalog(hid), key),
    { name: name.trim().slice(0, 120), count: increment(0), category: category ?? deleteField() },
    { merge: true },
  );
}

/**
 * Sets the category for names seen on receipts (and any items on the lists with those names), so the
 * spending breakdown and the list both learn it.
 */
export async function setCategoryFor(
  hid: string,
  uid: string,
  names: string[],
  category: CategoryId | null,
  listItems: Item[],
) {
  const batch = writeBatch(db);
  const keys = new Set<string>();
  for (const name of names) {
    const key = catalogKey(name);
    if (!key || keys.has(key)) continue;
    keys.add(key);
    rememberCategory(batch, hid, name, category);
  }
  for (const item of listItems)
    if (keys.has(catalogKey(item.name)))
      batch.update(doc(items(hid), item.id), {
        category: category ?? deleteField(),
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      });
  await batch.commit();
}

/** Every change writes its activity entry in the same atomic batch, so the log can't miss anything. */
function log(
  batch: WriteBatch,
  hid: string,
  uid: string,
  type: ActivityType,
  changed: { id: string; name: string }[],
  extra: { store?: StoreId; detail?: string; batchId?: string } = {},
) {
  batch.set(doc(activity(hid)), {
    actorId: uid,
    type,
    itemIds: changed.map((c) => c.id),
    itemNames: changed.map((c) => c.name),
    batchId: extra.batchId ?? nextBatchId(),
    at: serverTimestamp(),
    ...(extra.store ? { store: extra.store } : {}),
    ...(extra.detail ? { detail: extra.detail } : {}),
  });
}

export interface AddResult {
  added: string[];
  skipped: string[];
}

/**
 * Adds one or more items. Names already open (or ordered) on the same list are skipped, not
 * duplicated. Something added before comes back with the stores, prices and aisles it had.
 */
export async function addItems(
  hid: string,
  uid: string,
  entries: QuickAdd[],
  opts: { list: ListId; store: StoreId; existing: Item[]; catalog?: CatalogEntry[] },
): Promise<AddResult> {
  const openNames = new Set(
    opts.existing
      .filter((i) => i.list === opts.list && i.status !== 'checked')
      .map((i) => i.normalizedName),
  );
  const known = new Map((opts.catalog ?? []).map((c) => [c.key, c]));
  const now = Date.now();
  const batch = writeBatch(db);
  const added: { id: string; name: string }[] = [];
  const skipped: string[] = [];
  for (const entry of entries) {
    const normalizedName = normalizeName(entry.name);
    if (!normalizedName || openNames.has(normalizedName)) {
      skipped.push(entry.name);
      continue;
    }
    openNames.add(normalizedName);
    const ref = doc(items(hid));
    const key = catalogKey(entry.name);
    const before = known.get(key);
    // Imports can name their own store and price; otherwise use the current store.
    const store = entry.store ?? opts.store;
    const stores = [store, ...(before?.stores ?? []).filter((s) => s !== store)].slice(0, 3);
    const storeInfo: Partial<Record<StoreId, StoreInfo>> = Object.fromEntries(
      Object.entries(before?.storeInfo ?? {}).filter(([s]) => stores.includes(s as StoreId)),
    );
    if (entry.priceCents != null) {
      storeInfo[store] = {
        ...storeInfo[store],
        price: { cents: entry.priceCents, kind: entry.priceKind ?? 'manual', at: now },
      };
    }
    batch.set(ref, {
      name: entry.name.slice(0, 120),
      normalizedName,
      list: opts.list,
      qty: Math.min(999, Math.max(1, Math.round(entry.qty) || 1)),
      unit: '',
      note: (entry.note ?? '').slice(0, 300),
      stores,
      storeInfo,
      ...(before?.category ? { category: before.category } : {}),
      status: 'open',
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    added.push({ id: ref.id, name: entry.name });
    if (key)
      batch.set(
        doc(catalog(hid), key),
        {
          name: (before?.name ?? entry.name).slice(0, 120),
          count: increment(1),
          addedAt: nextAddedAt(before?.addedAt, now),
          stores,
          storeInfo,
        },
        { merge: true },
      );
  }
  if (added.length) {
    // One activity entry per add, sharing a batch id so the feed groups them.
    const batchId = nextBatchId();
    for (const a of added) log(batch, hid, uid, 'add', [a], { batchId, store: opts.store });
    await batch.commit();
  }
  return { added: added.map((a) => a.name), skipped };
}

export async function setChecked(
  hid: string,
  uid: string,
  item: Item,
  checked: boolean,
  store?: StoreId,
) {
  const batch = writeBatch(db);
  batch.update(doc(items(hid), item.id), {
    status: checked ? 'checked' : 'open',
    checkedBy: checked ? uid : deleteField(),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  });
  log(batch, hid, uid, checked ? 'check' : 'uncheck', [item], { store });
  await batch.commit();
}

export async function moveItem(hid: string, uid: string, item: Item, list: ListId) {
  if (item.list === list) return;
  const batch = writeBatch(db);
  batch.update(doc(items(hid), item.id), { list, updatedBy: uid, updatedAt: serverTimestamp() });
  log(batch, hid, uid, 'move', [item], { detail: list });
  await batch.commit();
}

export interface ItemEdit {
  name: string;
  qty: number;
  note: string;
  stores: StoreId[];
  storeInfo: Partial<Record<StoreId, StoreInfo>>;
  list: ListId;
  /** undefined: let the app guess from the name. */
  category?: CategoryId;
  /** '' or undefined: none. */
  substitute?: string;
  /** The list's name, for the activity log when the item moves to a custom list. */
  listName?: string;
}

/** Short description of what changed, for the activity log ("price, aisle"). */
export function describeEdit(before: Item, after: ItemEdit): string {
  const parts: string[] = [];
  if (before.name !== after.name) parts.push('name');
  if (before.qty !== after.qty) parts.push('quantity');
  if (before.note !== after.note) parts.push('note');
  if (before.stores.join() !== after.stores.join()) parts.push('stores');
  if ((before.category ?? null) !== (after.category ?? null)) parts.push('category');
  if ((before.substitute ?? '') !== (after.substitute ?? '').trim()) parts.push('substitute');
  const prices = (i: Partial<Record<StoreId, StoreInfo>>) =>
    JSON.stringify(
      Object.entries(i)
        .map(([k, v]) => [k, v?.price?.cents ?? null])
        .sort(),
    );
  const aisles = (i: Partial<Record<StoreId, StoreInfo>>) =>
    JSON.stringify(
      Object.entries(i)
        .map(([k, v]) => [k, v?.aisle?.label ?? null])
        .sort(),
    );
  if (prices(before.storeInfo) !== prices(after.storeInfo)) parts.push('price');
  const sizes = (i: Partial<Record<StoreId, StoreInfo>>) =>
    JSON.stringify(
      Object.entries(i)
        .map(([k, v]) => [k, v?.size ?? null])
        .sort(),
    );
  if (sizes(before.storeInfo) !== sizes(after.storeInfo)) parts.push('size');
  if (aisles(before.storeInfo) !== aisles(after.storeInfo)) parts.push('aisle');
  return parts.join(', ');
}

export async function saveItem(hid: string, uid: string, item: Item, edit: ItemEdit) {
  const changes = describeEdit(item, edit);
  const moved = item.list !== edit.list;
  if (!changes && !moved) return;
  const batch = writeBatch(db);
  batch.update(doc(items(hid), item.id), {
    name: edit.name.trim().slice(0, 120) || item.name,
    normalizedName: normalizeName(edit.name) || item.normalizedName,
    qty: Math.min(999, Math.max(1, Math.round(edit.qty) || 1)),
    note: edit.note.slice(0, 300),
    stores: edit.stores,
    storeInfo: edit.storeInfo,
    list: edit.list,
    category: edit.category ?? deleteField(),
    substitute: edit.substitute?.trim() ? edit.substitute.trim().slice(0, 80) : deleteField(),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  });
  // Remember the category for this name, so it comes back next time and labels receipt lines.
  if ((item.category ?? null) !== (edit.category ?? null))
    rememberCategory(batch, hid, edit.name, edit.category ?? null);
  if (changes)
    log(batch, hid, uid, 'edit', [{ id: item.id, name: edit.name }], { detail: changes });
  if (moved)
    log(batch, hid, uid, 'move', [{ id: item.id, name: edit.name }], {
      detail:
        edit.list === 'grocery' || edit.list === 'nice'
          ? edit.list
          : (edit.listName ?? 'another list'),
    });
  await batch.commit();
}

export async function deleteItems(hid: string, uid: string, toDelete: Item[]) {
  if (!toDelete.length) return;
  const batch = writeBatch(db);
  const batchId = nextBatchId();
  for (const item of toDelete) {
    batch.delete(doc(items(hid), item.id));
    rememberItem(batch, hid, item);
    log(batch, hid, uid, 'delete', [item], { batchId });
  }
  await batch.commit();
}

/** Marks items as in a placed pickup order. */
export async function placeOrder(hid: string, uid: string, toOrder: Item[], store: StoreId) {
  if (!toOrder.length) return;
  const batch = writeBatch(db);
  for (const item of toOrder)
    batch.update(doc(items(hid), item.id), {
      status: 'ordered',
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
  log(batch, hid, uid, 'order', toOrder.slice(0, 50), { store });
  await batch.commit();
}

/** Picked up: every ordered item is checked off. */
export async function pickUpOrder(hid: string, uid: string, ordered: Item[], store: StoreId) {
  if (!ordered.length) return;
  const batch = writeBatch(db);
  for (const item of ordered)
    batch.update(doc(items(hid), item.id), {
      status: 'checked',
      checkedBy: uid,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
  log(batch, hid, uid, 'pickup', ordered.slice(0, 50), { store });
  await batch.commit();
}

/**
 * Ids of items that came in through a bulk add (an import or import link): every "add" in the
 * activity log whose single write added at least `minBatch` items.
 */
export async function bulkAddedIds(hid: string, minBatch = 10): Promise<Set<string>> {
  const snap = await getDocs(query(activity(hid), where('type', '==', 'add')));
  const byBatch = new Map<string, string[]>();
  for (const d of snap.docs) {
    const e = d.data();
    const ids: string[] = Array.isArray(e.itemIds) ? e.itemIds : [];
    // Everything one add wrote shares a server timestamp; batch ids alone also merge separate
    // adds made within a minute of each other.
    const at = typeof e.at?.toMillis === 'function' ? e.at.toMillis() : String(e.at);
    const key = `${e.batchId ?? d.id}|${at}`;
    byBatch.set(key, [...(byBatch.get(key) ?? []), ...ids]);
  }
  return new Set([...byBatch.values()].filter((ids) => ids.length >= minBatch).flat());
}
