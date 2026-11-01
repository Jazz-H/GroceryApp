import { Timestamp, type DocumentData, type DocumentSnapshot } from 'firebase/firestore';
import type { ActivityEvent, Household, Item, Trip } from '../types';
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
    status: d.status === 'checked' ? 'checked' : 'open',
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
