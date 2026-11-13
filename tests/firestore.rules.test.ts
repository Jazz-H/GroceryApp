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
  increment,
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

  it('allows logging that someone joined a trip', async () => {
    await assertSucceeds(
      setDoc(doc(as('alex'), 'households', HID, 'activity', 'e6'), {
        actorId: 'alex',
        type: 'trip_join',
        itemIds: [],
        itemNames: [],
        batchId: 'b6',
        store: 'ht',
        at: serverTimestamp(),
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

function receipt(by: string, paidBy = by) {
  return {
    store: 'ht',
    purchasedAt: 1767000000000,
    paidBy,
    createdBy: by,
    createdAt: serverTimestamp(),
    subtotalCents: 399,
    taxCents: 0,
    savingsCents: 0,
    totalCents: 399,
    lines: [{ raw: 'MILK', name: 'Milk', qty: 1, cents: 399, itemId: 'milk' }],
  };
}

describe('receipts', () => {
  it('saves a receipt, its prices, a remembered match and the log entry in one batch', async () => {
    const db = as('alex');
    const batch = writeBatch(db);
    batch.set(doc(db, 'households', HID, 'receipts', 'r1'), receipt('alex'));
    batch.update(doc(db, 'households', HID, 'items', 'milk'), {
      'storeInfo.ht.price': { cents: 399, kind: 'paid', at: 1767000000000 },
      status: 'checked',
      checkedBy: 'alex',
      updatedBy: 'alex',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'households', HID, 'aliases', 'ht~milk'), {
      itemId: 'milk',
      store: 'ht',
      raw: 'MILK',
      by: 'alex',
    });
    batch.set(doc(db, 'households', HID, 'activity', 'e5'), {
      actorId: 'alex',
      type: 'receipt',
      itemIds: ['milk'],
      itemNames: ['Milk'],
      batchId: 'b5',
      store: 'ht',
      detail: '$3.99',
      at: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });

  it('blocks non-members and faked authors or payers', async () => {
    await assertFails(setDoc(doc(as('sam'), 'households', HID, 'receipts', 'r2'), receipt('sam')));
    await assertFails(setDoc(doc(as('alex'), 'households', HID, 'receipts', 'r3'), receipt('sam')));
    await assertFails(
      setDoc(doc(as('alex'), 'households', HID, 'receipts', 'r4'), receipt('alex', 'mallory')),
    );
    await assertFails(getDocs(collection(as('sam'), 'households', HID, 'receipts')));
  });

  it('lets members fix and delete receipts but keeps the author', async () => {
    const ref = doc(as('alex'), 'households', HID, 'receipts', 'r5');
    await assertSucceeds(setDoc(ref, receipt('alex')));
    await assertSucceeds(updateDoc(ref, { totalCents: 450 }));
    await assertFails(updateDoc(ref, { createdBy: 'sam' }));
    await assertSucceeds(deleteDoc(ref));
  });

  it('keeps remembered matches private to the household', async () => {
    await assertFails(
      setDoc(doc(as('sam'), 'households', HID, 'aliases', 'ht~x'), { itemId: 'milk' }),
    );
    await assertFails(setDoc(doc(as('alex'), 'households', HID, 'aliases', 'ht~y'), { itemId: 3 }));
  });
});

describe('usuals catalog and pickup orders', () => {
  it('adds an item and its catalog entry together, and keeps the entry when the item is removed', async () => {
    const db = as('alex');
    const add = writeBatch(db);
    add.set(doc(db, 'households', HID, 'items', 'eggs'), {
      ...item('alex'),
      name: 'Eggs',
      normalizedName: 'eggs',
    });
    add.set(
      doc(db, 'households', HID, 'catalog', 'eggs'),
      { name: 'Eggs', count: increment(1), addedAt: [1], stores: ['ht'], storeInfo: {} },
      { merge: true },
    );
    await assertSucceeds(add.commit());

    const remove = writeBatch(db);
    remove.delete(doc(db, 'households', HID, 'items', 'eggs'));
    remove.set(
      doc(db, 'households', HID, 'catalog', 'eggs'),
      { name: 'Eggs', stores: ['ht'], storeInfo: {}, count: increment(0) },
      { merge: true },
    );
    await assertSucceeds(remove.commit());
    // First-ever snapshot of an item the catalog hasn't seen (count created at 0).
    await assertSucceeds(
      setDoc(
        doc(db, 'households', HID, 'catalog', 'milk'),
        { name: 'Milk', stores: ['ht'], storeInfo: {}, count: increment(0) },
        { merge: true },
      ),
    );
  });

  it('keeps the catalog private and well-formed', async () => {
    await assertFails(getDocs(collection(as('sam'), 'households', HID, 'catalog')));
    await assertFails(
      setDoc(doc(as('sam'), 'households', HID, 'catalog', 'x'), { name: 'X', count: 1 }),
    );
    await assertFails(setDoc(doc(as('alex'), 'households', HID, 'catalog', 'y'), { name: 'Y' }));
  });

  it('puts items on custom lists, and keeps the household’s lists short', async () => {
    const db = as('alex');
    const ref = doc(db, 'households', HID, 'items', 'tp');
    await assertSucceeds(setDoc(ref, { ...item('alex'), name: 'TP', list: 'l_costco01' }));
    await assertFails(updateDoc(ref, { list: 'costco', updatedBy: 'alex' }));
    await assertSucceeds(
      updateDoc(doc(db, 'households', HID), { lists: [{ id: 'l_costco01', name: 'Costco' }] }),
    );
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `l_list0000${i}`, name: `L${i}` }));
    await assertFails(updateDoc(doc(db, 'households', HID), { lists: many }));
  });

  it('keeps a short substitute on an item', async () => {
    const db = as('alex');
    const ref = doc(db, 'households', HID, 'items', 'oat');
    await assertSucceeds(
      setDoc(ref, { ...item('alex'), name: 'Oat milk', substitute: 'almond milk' }),
    );
    await assertFails(updateDoc(ref, { substitute: 'x'.repeat(81), updatedBy: 'alex' }));
    await assertFails(updateDoc(ref, { substitute: 7, updatedBy: 'alex' }));
  });

  it('remembers a category on items and catalog entries, and rejects junk', async () => {
    const db = as('alex');
    const itemRef = doc(db, 'households', HID, 'items', 'yog');
    await assertSucceeds(setDoc(itemRef, { ...item('alex'), name: 'Yogurt', category: 'dairy' }));
    await assertSucceeds(updateDoc(itemRef, { category: 'snacks', updatedBy: 'alex' }));
    await assertFails(updateDoc(itemRef, { category: 42, updatedBy: 'alex' }));
    await assertFails(updateDoc(itemRef, { category: 'x'.repeat(40), updatedBy: 'alex' }));

    const entry = doc(db, 'households', HID, 'catalog', 'yogurt');
    await assertSucceeds(
      setDoc(entry, { name: 'Yogurt', count: increment(0), category: 'dairy' }, { merge: true }),
    );
    await assertFails(
      setDoc(entry, { name: 'Yogurt', count: increment(0), category: ['dairy'] }, { merge: true }),
    );
  });

  it('allows placing and picking up a pickup order, with feed entries', async () => {
    const db = as('alex');
    const order = writeBatch(db);
    order.update(doc(db, 'households', HID, 'items', 'milk'), {
      status: 'ordered',
      updatedBy: 'alex',
      updatedAt: serverTimestamp(),
    });
    order.set(doc(db, 'households', HID, 'activity', 'o1'), {
      actorId: 'alex',
      type: 'order',
      itemIds: ['milk'],
      itemNames: ['Milk'],
      batchId: 'bo',
      store: 'target',
      at: serverTimestamp(),
    });
    await assertSucceeds(order.commit());

    const pickup = writeBatch(db);
    pickup.update(doc(db, 'households', HID, 'items', 'milk'), {
      status: 'checked',
      checkedBy: 'alex',
      updatedBy: 'alex',
      updatedAt: serverTimestamp(),
    });
    pickup.set(doc(db, 'households', HID, 'activity', 'p1'), {
      actorId: 'alex',
      type: 'pickup',
      itemIds: ['milk'],
      itemNames: ['Milk'],
      batchId: 'bp',
      store: 'target',
      at: serverTimestamp(),
    });
    await assertSucceeds(pickup.commit());
  });

  it('still rejects unknown item statuses', async () => {
    await assertFails(
      updateDoc(doc(as('alex'), 'households', HID, 'items', 'milk'), {
        status: 'lost',
        updatedBy: 'alex',
      }),
    );
  });
});

describe('settle up and barcodes', () => {
  async function samJoins() {
    await updateDoc(doc(as('sam'), 'households', HID), {
      memberIds: arrayUnion('sam'),
      'members.sam': { name: 'Sam', color: '#d4466a' },
      joinCode: CODE,
    });
  }
  const settlement = (by: string, from: string, to: string, cents: number) => ({
    by,
    from,
    to,
    cents,
    at: serverTimestamp(),
  });

  it('lets members record a settle-up between members, and undo it', async () => {
    await samJoins();
    const ref = doc(as('sam'), 'households', HID, 'settlements', 's1');
    await assertSucceeds(setDoc(ref, settlement('sam', 'sam', 'alex', 3000)));
    await assertSucceeds(getDoc(doc(as('alex'), 'households', HID, 'settlements', 's1')));
    await assertFails(updateDoc(ref, { cents: 1 }));
    await assertSucceeds(deleteDoc(doc(as('alex'), 'households', HID, 'settlements', 's1')));
  });

  it('rejects bad settle-ups and outsiders', async () => {
    await samJoins();
    const col = (uid: string, id: string) => doc(as(uid), 'households', HID, 'settlements', id);
    await assertFails(setDoc(col('sam', 'a'), settlement('alex', 'sam', 'alex', 100))); // not by me
    await assertFails(setDoc(col('sam', 'b'), settlement('sam', 'sam', 'sam', 100))); // to self
    await assertFails(setDoc(col('sam', 'c'), settlement('sam', 'sam', 'pat', 100))); // non-member
    await assertFails(setDoc(col('sam', 'd'), settlement('sam', 'sam', 'alex', 0)));
    await assertFails(setDoc(col('pat', 'e'), settlement('pat', 'sam', 'alex', 100)));
  });

  it('lets members remember barcodes', async () => {
    const ref = (uid: string) => doc(as(uid), 'households', HID, 'barcodes', '0123456789012');
    await assertSucceeds(setDoc(ref('alex'), { name: 'Chobani yogurt' }));
    await assertFails(setDoc(ref('alex'), { name: 5 }));
    await assertFails(getDoc(ref('sam')));
  });
});
