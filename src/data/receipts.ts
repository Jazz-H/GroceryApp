import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { formatCents } from '../lib/money';
import { aliasKey, unitCents, type ReceiptDraft } from '../lib/receipts';
import { isStoreId } from '../lib/stores';
import type { Household, Item, Receipt } from '../types';

const receipts = (hid: string) => collection(db, 'households', hid, 'receipts');
const aliases = (hid: string) => collection(db, 'households', hid, 'aliases');
const items = (hid: string) => collection(db, 'households', hid, 'items');
const activity = (hid: string) => collection(db, 'households', hid, 'activity');

export interface SaveResult {
  priced: number;
  checked: number;
}

/**
 * Saves a reviewed receipt in one atomic batch:
 * - the receipt itself
 * - the price actually paid on each matched item (unless a newer price is already there)
 * - matched items that were still open get checked off (not for past receipts from a link)
 * - each match is remembered, so the same printed line matches by itself next time
 * - one activity entry
 */
export async function saveReceipt(
  hid: string,
  uid: string,
  draft: ReceiptDraft,
  allItems: Item[],
  { checkOff = true }: { checkOff?: boolean } = {},
): Promise<SaveResult> {
  const batch = writeBatch(db);
  const byId = new Map(allItems.map((i) => [i.id, i]));
  batch.set(doc(receipts(hid)), {
    ...draft,
    lines: draft.lines.map((l) => ({
      ...l,
      itemId: l.itemId ?? null,
      // The item's name, so its price history survives clearing and re-adding it.
      itemKey: (l.itemId && byId.get(l.itemId)?.normalizedName) || null,
    })),
    createdBy: uid,
    createdAt: serverTimestamp(),
  });

  // The last line wins when one item shows up twice on a receipt.
  const matched = new Map<string, ReceiptDraft['lines'][number]>();
  for (const l of draft.lines) if (l.itemId && byId.has(l.itemId)) matched.set(l.itemId, l);

  let priced = 0;
  let checked = 0;
  const store = draft.store;
  for (const [id, line] of matched) {
    const item = byId.get(id)!;
    const update: Record<string, unknown> = { updatedBy: uid, updatedAt: serverTimestamp() };
    if (isStoreId(store)) {
      const existing = item.storeInfo[store]?.price;
      if (!existing || existing.at <= draft.purchasedAt) {
        update[`storeInfo.${store}.price`] = {
          cents: unitCents(line),
          kind: 'paid',
          at: draft.purchasedAt,
        };
        priced += 1;
      }
      if (!item.stores.includes(store)) update.stores = arrayUnion(store);
    }
    if (checkOff && item.status !== 'checked') {
      update.status = 'checked';
      update.checkedBy = uid;
      checked += 1;
    }
    batch.update(doc(items(hid), id), update);
  }

  for (const l of draft.lines)
    if (l.itemId && byId.has(l.itemId))
      batch.set(doc(aliases(hid), aliasKey(store, l.raw)), {
        itemId: l.itemId,
        store,
        raw: l.raw.slice(0, 120),
        by: uid,
      });

  const names = [...matched.keys()].map((id) => byId.get(id)!.name);
  batch.set(doc(activity(hid)), {
    actorId: uid,
    type: 'receipt',
    itemIds: [...matched.keys()].slice(0, 50),
    itemNames: names.slice(0, 50),
    batchId: crypto.randomUUID().slice(0, 8),
    at: serverTimestamp(),
    detail: formatCents(draft.totalCents),
    ...(isStoreId(store) ? { store } : {}),
  });

  await batch.commit();
  return { priced, checked };
}

export async function setReceiptPaidBy(hid: string, receipt: Receipt, paidBy: string) {
  await updateDoc(doc(receipts(hid), receipt.id), { paidBy });
}

/** Moves many receipts to one payer, in batches of 400 (Firestore allows 500 writes per batch). */
export async function setPaidByForAll(hid: string, list: Receipt[], paidBy: string) {
  for (let i = 0; i < list.length; i += 400) {
    const batch = writeBatch(db);
    for (const r of list.slice(i, i + 400)) batch.update(doc(receipts(hid), r.id), { paidBy });
    await batch.commit();
  }
}

/** Applies small field changes (payer, payments) to saved receipts, 400 per batch. */
export async function updateReceipts(
  hid: string,
  updates: { id: string; patch: Partial<Pick<Receipt, 'paidBy' | 'payments'>> }[],
) {
  for (let i = 0; i < updates.length; i += 400) {
    const batch = writeBatch(db);
    for (const u of updates.slice(i, i + 400)) batch.update(doc(receipts(hid), u.id), u.patch);
    await batch.commit();
  }
}

/** Removes a receipt from spending. Prices it set on items stay. */
export async function deleteReceipt(hid: string, receipt: Receipt) {
  await deleteDoc(doc(receipts(hid), receipt.id));
}

export async function setBudget(household: Household, cents: number | null) {
  await updateDoc(doc(db, 'households', household.id), {
    budgetCents: cents && cents > 0 ? cents : deleteField(),
  });
}
