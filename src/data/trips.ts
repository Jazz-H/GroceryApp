import { arrayUnion, collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import type { StoreId, Trip, TripMode } from '../types';

const trips = (hid: string) => collection(db, 'households', hid, 'trips');
const activity = (hid: string) => collection(db, 'households', hid, 'activity');

function logTrip(
  batch: ReturnType<typeof writeBatch>,
  hid: string,
  uid: string,
  type: 'trip_start' | 'trip_end',
  store: StoreId,
  detail?: string,
) {
  batch.set(doc(activity(hid)), {
    actorId: uid,
    type,
    itemIds: [],
    itemNames: [],
    batchId: crypto.randomUUID().slice(0, 8),
    store,
    at: serverTimestamp(),
    ...(detail ? { detail } : {}),
  });
}

export async function startTrip(hid: string, uid: string, store: StoreId, mode: TripMode) {
  const batch = writeBatch(db);
  batch.set(doc(trips(hid)), {
    store,
    mode,
    startedBy: uid,
    participants: [uid],
    status: 'active',
    startedAt: serverTimestamp(),
  });
  logTrip(batch, hid, uid, 'trip_start', store, mode);
  await batch.commit();
}

export async function joinTrip(hid: string, uid: string, trip: Trip) {
  const batch = writeBatch(db);
  batch.update(doc(trips(hid), trip.id), { participants: arrayUnion(uid), mode: 'together' });
  await batch.commit();
}

export async function endTrip(hid: string, uid: string, trip: Trip) {
  const batch = writeBatch(db);
  batch.update(doc(trips(hid), trip.id), {
    status: 'ended',
    endedAt: serverTimestamp(),
    endedBy: uid,
  });
  logTrip(batch, hid, uid, 'trip_end', trip.store);
  await batch.commit();
}
