import {
  collection,
  deleteField,
  doc,
  serverTimestamp,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { createBatcher } from '../lib/activity';
import { normalizeName, type QuickAdd } from '../lib/text';
import type { ActivityType, Item, ListId, StoreId, StoreInfo } from '../types';

const nextBatchId = createBatcher(
  () => Date.now(),
  () => crypto.randomUUID().slice(0, 8),
);

const items = (hid: string) => collection(db, 'households', hid, 'items');
const activity = (hid: string) => collection(db, 'households', hid, 'activity');

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

/** Adds one or more items. Names already open on the same list are skipped, not duplicated. */
export async function addItems(
  hid: string,
  uid: string,
  entries: QuickAdd[],
  opts: { list: ListId; store: StoreId; existing: Item[] },
): Promise<AddResult> {
  const openNames = new Set(
    opts.existing
      .filter((i) => i.list === opts.list && i.status === 'open')
      .map((i) => i.normalizedName),
  );
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
    const store = entry.store ?? opts.store;
    const storeInfo =
      entry.priceCents != null
        ? {
            [store]: {
              price: { cents: entry.priceCents, kind: entry.priceKind ?? 'manual', at: Date.now() },
            },
          }
        : {};
    batch.set(ref, {
      name: entry.name.slice(0, 120),
      normalizedName,
      list: opts.list,
      qty: Math.min(999, Math.max(1, Math.round(entry.qty) || 1)),
      unit: '',
      note: (entry.note ?? '').slice(0, 300),
      stores: [store],
      storeInfo,
      status: 'open',
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    added.push({ id: ref.id, name: entry.name });
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
}

/** Short description of what changed, for the activity log ("price, aisle"). */
export function describeEdit(before: Item, after: ItemEdit): string {
  const parts: string[] = [];
  if (before.name !== after.name) parts.push('name');
  if (before.qty !== after.qty) parts.push('quantity');
  if (before.note !== after.note) parts.push('note');
  if (before.stores.join() !== after.stores.join()) parts.push('stores');
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
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  });
  if (changes)
    log(batch, hid, uid, 'edit', [{ id: item.id, name: edit.name }], { detail: changes });
  if (moved)
    log(batch, hid, uid, 'move', [{ id: item.id, name: edit.name }], { detail: edit.list });
  await batch.commit();
}

export async function deleteItems(hid: string, uid: string, toDelete: Item[]) {
  if (!toDelete.length) return;
  const batch = writeBatch(db);
  const batchId = nextBatchId();
  for (const item of toDelete) {
    batch.delete(doc(items(hid), item.id));
    log(batch, hid, uid, 'delete', [item], { batchId });
  }
  await batch.commit();
}
