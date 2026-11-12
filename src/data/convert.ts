import { Timestamp, type DocumentData, type DocumentSnapshot } from 'firebase/firestore';
import type {
  ActivityEvent,
  CatalogEntry,
  Household,
  Item,
  Receipt,
  Settlement,
  Trip,
} from '../types';
import { isCategoryId } from '../lib/categories';
import { isStoreId } from '../lib/stores';

/** Firestore timestamps (including pending local ones) → epoch ms. */
export function ms(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'number') return value;
  return Date.now();
}

function data(snap: DocumentSnapshot): DocumentData {
  return snap.data({ serverTimestamps: 'estimate' }) ?? {};
}

export function toItem(snap: DocumentSnapshot): Item {
  const d = data(snap);
  const stores = Array.isArray(d.stores) ? d.stores.filter(isStoreId) : [];
  return {
    id: snap.id,
    name: String(d.name ?? ''),
    normalizedName: String(d.normalizedName ?? ''),
    list: d.list === 'nice' ? 'nice' : 'grocery',
    qty: typeof d.qty === 'number' ? d.qty : 1,
    unit: String(d.unit ?? ''),
    note: String(d.note ?? ''),
    stores: stores.length ? stores : ['ht'],
    storeInfo: d.storeInfo ?? {},
    status: d.status === 'checked' || d.status === 'ordered' ? d.status : 'open',
    ...(isCategoryId(d.category) ? { category: d.category } : {}),
    createdBy: String(d.createdBy ?? ''),
    createdAt: ms(d.createdAt),
    updatedBy: String(d.updatedBy ?? ''),
    updatedAt: ms(d.updatedAt),
    checkedBy: d.checkedBy,
  };
}

export function toActivity(snap: DocumentSnapshot): ActivityEvent {
  const d = data(snap);
  return {
    id: snap.id,
    actorId: String(d.actorId ?? ''),
    type: d.type,
    itemIds: d.itemIds ?? [],
    itemNames: d.itemNames ?? [],
    batchId: String(d.batchId ?? snap.id),
    store: isStoreId(d.store) ? d.store : undefined,
    detail: d.detail,
    at: ms(d.at),
  };
}

export function toHousehold(snap: DocumentSnapshot): Household {
  const d = data(snap);
  return {
    id: snap.id,
    name: String(d.name ?? 'Home'),
    memberIds: d.memberIds ?? [],
    members: d.members ?? {},
    inviteCode: String(d.inviteCode ?? ''),
    zip: String(d.zip ?? ''),
    zoneOrder: d.zoneOrder ?? {},
    budgetCents: typeof d.budgetCents === 'number' && d.budgetCents > 0 ? d.budgetCents : null,
    ...(typeof d.recapSentFor === 'string' ? { recapSentFor: d.recapSentFor } : {}),
    ...(typeof d.weekRecapSentFor === 'string' ? { weekRecapSentFor: d.weekRecapSentFor } : {}),
  };
}

const RECEIPT_STORES = ['ht', 'target', 'amazon', 'other'];

const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);

export function toReceipt(snap: DocumentSnapshot): Receipt {
  const d = data(snap);
  const lines = Array.isArray(d.lines) ? d.lines : [];
  const payments = Array.isArray(d.payments) ? d.payments : [];
  return {
    id: snap.id,
    ...(d.kind === 'tip' ? { kind: 'tip' as const } : {}),
    ...(payments.length
      ? {
          payments: payments.map((p: DocumentData) => ({
            card: String(p.card ?? ''),
            last4: String(p.last4 ?? ''),
            cents: int(p.cents),
          })),
        }
      : {}),
    store: RECEIPT_STORES.includes(d.store) ? d.store : 'other',
    purchasedAt: ms(d.purchasedAt),
    paidBy: String(d.paidBy ?? ''),
    createdBy: String(d.createdBy ?? ''),
    createdAt: ms(d.createdAt),
    subtotalCents: int(d.subtotalCents),
    taxCents: int(d.taxCents),
    savingsCents: int(d.savingsCents),
    totalCents: int(d.totalCents),
    lines: lines.map((l: DocumentData) => ({
      raw: String(l.raw ?? ''),
      name: String(l.name ?? ''),
      qty: int(l.qty) || 1,
      cents: int(l.cents),
      itemId: typeof l.itemId === 'string' ? l.itemId : null,
      itemKey: typeof l.itemKey === 'string' ? l.itemKey : null,
    })),
  };
}

export function toCatalog(snap: DocumentSnapshot): CatalogEntry {
  const d = data(snap);
  const stores = Array.isArray(d.stores) ? d.stores.filter(isStoreId) : [];
  return {
    key: snap.id,
    name: String(d.name ?? ''),
    count: typeof d.count === 'number' ? d.count : 0,
    addedAt: Array.isArray(d.addedAt)
      ? d.addedAt.filter((t: unknown) => typeof t === 'number')
      : [],
    stores,
    storeInfo: d.storeInfo ?? {},
    ...(isCategoryId(d.category) ? { category: d.category } : {}),
  };
}

export function toTrip(snap: DocumentSnapshot): Trip {
  const d = data(snap);
  return {
    id: snap.id,
    store: isStoreId(d.store) ? d.store : 'ht',
    mode: d.mode === 'together' ? 'together' : 'solo',
    startedBy: String(d.startedBy ?? ''),
    participants: d.participants ?? [],
    status: d.status === 'ended' ? 'ended' : 'active',
    startedAt: ms(d.startedAt),
  };
}

export function toSettlement(snap: DocumentSnapshot): Settlement {
  const d = data(snap);
  return {
    id: snap.id,
    from: String(d.from ?? ''),
    to: String(d.to ?? ''),
    cents: typeof d.cents === 'number' ? Math.round(d.cents) : 0,
    by: String(d.by ?? ''),
    at: ms(d.at),
  };
}
