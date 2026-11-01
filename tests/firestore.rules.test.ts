import { afterAll, beforeEach, describe, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  arrayUnion,
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
  terminate,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

// Runs inside `firebase emulators:exec`, which loads firestore.rules from firebase.json.
const PROJECT = 'demo-fridgeboard';
const HOST = '127.0.0.1';
const PORT = 8080;
const HID = 'house1';
const CODE = 'ABC234';

const apps: FirebaseApp[] = [];
const dbs = new Map<string, Firestore>();

/** A Firestore client signed in as `uid` (or signed out when uid is null). */
function as(uid: string | null): Firestore {
  const key = uid ?? '(anon)';
  const existing = dbs.get(key);
  if (existing) return existing;
  const app = initializeApp({ projectId: PROJECT, apiKey: 'test' }, `app-${key}`);
  apps.push(app);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, HOST, PORT, uid ? { mockUserToken: { user_id: uid } } : undefined);
  dbs.set(key, db);
  return db;
}

async function assertSucceeds(p: Promise<unknown>) {
  await p;
}

async function assertFails(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'permission-denied') return;
    throw e;
  }
  throw new Error('Expected the write or read to be denied, but it succeeded');
}

async function clearFirestore() {
  await fetch(
    `http://${HOST}:${PORT}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    {
      method: 'DELETE',
    },
  );
}

afterAll(async () => {
  for (const db of dbs.values()) await terminate(db);
  for (const app of apps) await deleteApp(app);
});

beforeEach(async () => {
  await clearFirestore();
  // Alex sets up a household through the same writes the app makes.
  const db = as('alex');
  const batch = writeBatch(db);
  batch.set(doc(db, 'households', HID), {
    name: 'Our place',
    memberIds: ['alex'],
    members: { alex: { name: 'Alex', color: '#0f8a7e' } },
    inviteCode: CODE,
    zip: '28262',
    zoneOrder: {},
  });
  batch.set(doc(db, 'invites', CODE), { householdId: HID, createdBy: 'alex' });
  await batch.commit();
  const seed = writeBatch(db);
  seed.set(doc(db, 'households', HID, 'items', 'milk'), item('alex'));
  seed.set(doc(db, 'households', HID, 'activity', 'e1'), {
    actorId: 'alex',
    type: 'add',
    itemIds: ['milk'],
    itemNames: ['Milk'],
    batchId: 'b1',
    at: serverTimestamp(),
  });
  await seed.commit();
});

function item(by: string) {
  return {
    name: 'Milk',
    normalizedName: 'milk',
    list: 'grocery',
    qty: 1,
    unit: '',
    note: '',
    stores: ['ht'],
    storeInfo: {},
    status: 'open',
    createdBy: by,
    createdAt: 1,
    updatedBy: by,
    updatedAt: 1,
  };
}

describe('households', () => {
  it('lets members read and blocks everyone else', async () => {
    await assertSucceeds(getDoc(doc(as('alex'), 'households', HID)));
    await assertFails(getDoc(doc(as('sam'), 'households', HID)));
    await assertFails(getDoc(doc(as(null), 'households', HID)));
  });

  it('lets a new person create a household with only themselves', async () => {
    const db = as('sam');
    const batch = writeBatch(db);
    batch.set(doc(db, 'households', 'h2'), {
      name: 'Sam home',
      memberIds: ['sam'],
      members: { sam: { name: 'Sam', color: '#d4466a' } },
      inviteCode: 'ZZZ999',
      zip: '28262',
      zoneOrder: {},
    });
    batch.set(doc(db, 'invites', 'ZZZ999'), { householdId: 'h2', createdBy: 'sam' });
    await assertSucceeds(batch.commit());

    await assertFails(
      setDoc(doc(as('sam'), 'households', 'h3'), {
        name: 'Sneaky',
        memberIds: ['sam', 'alex'],
        members: { sam: {}, alex: {} },
        inviteCode: 'X',
      }),
    );
  });

  it('lets someone join with the right invite code', async () => {
    const db = as('sam');
    await assertSucceeds(getDoc(doc(db, 'invites', CODE)));
    await assertSucceeds(
      updateDoc(doc(db, 'households', HID), {
        memberIds: arrayUnion('sam'),
        'members.sam': { name: 'Sam', color: '#d4466a' },
        joinCode: CODE,
      }),
    );
    await assertSucceeds(getDoc(doc(db, 'households', HID)));
  });

  it('blocks joining with a wrong code or adding someone else', async () => {
    await assertFails(
      updateDoc(doc(as('sam'), 'households', HID), {
        memberIds: arrayUnion('sam'),
        'members.sam': { name: 'Sam' },
        joinCode: 'WRONG1',
      }),
    );
    await assertFails(
      updateDoc(doc(as('sam'), 'households', HID), {
        memberIds: arrayUnion('sam', 'mallory'),
        'members.sam': { name: 'Sam' },
        joinCode: CODE,
      }),
    );
  });

  it('does not let a member add someone directly', async () => {
    await assertFails(
      updateDoc(doc(as('alex'), 'households', HID), { memberIds: arrayUnion('mallory') }),
    );
  });

  it('does not allow listing invite codes', async () => {
    await assertFails(getDocs(collection(as('sam'), 'invites')));
  });
});

describe('items', () => {
  it('lets members add items as themselves only', async () => {
    await assertSucceeds(setDoc(doc(as('alex'), 'households', HID, 'items', 'eggs'), item('alex')));
    await assertFails(setDoc(doc(as('alex'), 'households', HID, 'items', 'eggs2'), item('sam')));
    await assertFails(setDoc(doc(as('sam'), 'households', HID, 'items', 'eggs3'), item('sam')));
  });

  it('rejects invalid items', async () => {
    await assertFails(
      setDoc(doc(as('alex'), 'households', HID, 'items', 'bad'), {
        ...item('alex'),
        list: 'wishlist',
      }),
    );
    await assertFails(
      setDoc(doc(as('alex'), 'households', HID, 'items', 'bad2'), { ...item('alex'), name: '' }),
    );
  });

  it('keeps who created an item when it is edited', async () => {
    const ref = doc(as('alex'), 'households', HID, 'items', 'milk');
    await assertSucceeds(updateDoc(ref, { status: 'checked', updatedBy: 'alex', updatedAt: 2 }));
    await assertFails(updateDoc(ref, { createdBy: 'alex2', updatedBy: 'alex' }));
  });
});

describe('activity log', () => {
  it('allows appending entries as yourself with a server timestamp', async () => {
    const db = as('alex');
    await assertSucceeds(
      setDoc(doc(db, 'households', HID, 'activity', 'e2'), {
        actorId: 'alex',
        type: 'check',
        itemIds: ['milk'],
        itemNames: ['Milk'],
        batchId: 'b2',
        at: serverTimestamp(),
      }),
    );
  });

  it('blocks faking the actor or the time', async () => {
    const db = as('alex');
    await assertFails(
      setDoc(doc(db, 'households', HID, 'activity', 'e3'), {
        actorId: 'sam',
        type: 'add',
        itemIds: [],
        itemNames: [],
        batchId: 'b',
        at: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(db, 'households', HID, 'activity', 'e4'), {
        actorId: 'alex',
        type: 'add',
        itemIds: [],
        itemNames: [],
        batchId: 'b',
        at: new Date(2020, 1, 1),
      }),
    );
  });

  it('never allows editing or deleting entries', async () => {
    const ref = doc(as('alex'), 'households', HID, 'activity', 'e1');
    await assertFails(updateDoc(ref, { itemNames: ['Nothing'] }));
    await assertFails(deleteDoc(ref));
  });
});

describe('push subscriptions', () => {
  const sub = (uid: string) => ({
    uid,
    endpoint: 'https://push.example.com/abc',
    p256dh: 'BPx',
    auth: 'xyz',
    prefs: { adds: true, trip: true },
    device: 'Android',
  });

  it('lets a member save their own phone and read others', async () => {
    await assertSucceeds(setDoc(doc(as('alex'), 'households', HID, 'pushSubs', 's1'), sub('alex')));
    await assertSucceeds(getDocs(collection(as('alex'), 'households', HID, 'pushSubs')));
  });

  it('blocks saving a subscription for someone else or from outside', async () => {
    await assertFails(setDoc(doc(as('alex'), 'households', HID, 'pushSubs', 's2'), sub('sam')));
    await assertFails(setDoc(doc(as('sam'), 'households', HID, 'pushSubs', 's3'), sub('sam')));
    await assertFails(getDocs(collection(as('sam'), 'households', HID, 'pushSubs')));
  });

  it('rejects non-https endpoints', async () => {
    await assertFails(
      setDoc(doc(as('alex'), 'households', HID, 'pushSubs', 's4'), {
        ...sub('alex'),
        endpoint: 'http://evil.example.com',
      }),
    );
  });
});
