// Voice add, end to end against the Firestore emulator: the relay's /add route writes signed
// out, and the rules accept it only with a voice key whose hash a member saved.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  arrayUnion,
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  setDoc,
  terminate,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { handle, type Env } from '../worker/src/index';
import { resetVoiceLimits } from '../worker/src/voice';

const PROJECT = 'demo-fridgeboard';
const HID = 'voice-house';
const BASE = 'http://127.0.0.1:8080/v1';
const DOCS = `projects/${PROJECT}/databases/(default)/documents`;
const apps: ReturnType<typeof initializeApp>[] = [];
const dbs: Firestore[] = [];

function client(uid: string) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'x' }, `voice-${uid}`);
  apps.push(app);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080, { mockUserToken: { user_id: uid } });
  dbs.push(db);
  return db;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const KEY = `${HID}.alex.${'k'.repeat(40)}`;
const env: Env = {
  VAPID_PUBLIC_KEY: '',
  VAPID_PRIVATE_KEY: '',
  VAPID_SUBJECT: '',
  FIREBASE_PROJECT_ID: PROJECT,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  FIRESTORE_BASE: BASE,
};
let alex: Firestore;
let sam: Firestore;

const say = (key: string, text: string) =>
  handle(
    new Request('https://relay/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, text }),
    }),
    env,
  );

/** A signed-out commit straight to Firestore, as someone with no relay would try. */
const commit = (writes: unknown[]) =>
  fetch(`${BASE}/${DOCS}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes }),
  });

const s = (v: string) => ({ stringValue: v });
function voiceItem(id: string, key: string, extra: Record<string, unknown> = {}) {
  return {
    update: {
      name: `${DOCS}/households/${HID}/items/${id}`,
      fields: {
        name: s('Milk'),
        normalizedName: s('milk'),
        list: s('grocery'),
        qty: { integerValue: '1' },
        stores: { arrayValue: { values: [s('ht')] } },
        status: s('open'),
        createdBy: s('alex'),
        updatedBy: s('alex'),
        via: s('voice'),
        voiceKey: s(key),
        ...extra,
      },
    },
    updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
  };
}

beforeAll(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/${DOCS}`, { method: 'DELETE' });
  alex = client('alex');
  sam = client('sam');
  const b = writeBatch(alex);
  b.set(doc(alex, 'households', HID), {
    name: 'Voice test',
    memberIds: ['alex'],
    members: { alex: { name: 'Alex', color: '#0f8a7e' } },
    inviteCode: 'VOICE2',
    zip: '28262',
    zoneOrder: {},
  });
  b.set(doc(alex, 'invites', 'VOICE2'), { householdId: HID, createdBy: 'alex' });
  await b.commit();
  await updateDoc(doc(sam, 'households', HID), {
    memberIds: arrayUnion('sam'),
    'members.sam': { name: 'Sam', color: '#d4466a' },
    joinCode: 'VOICE2',
  });
});

beforeEach(async () => {
  resetVoiceLimits();
  // Keys can't be overwritten, so start each test from a fresh one.
  await deleteDoc(doc(alex, 'households', HID, 'voiceKeys', sha(KEY)));
  await setDoc(doc(alex, 'households', HID, 'voiceKeys', sha(KEY)), {
    uid: 'alex',
    label: 'Alex’s iPhone',
    createdAt: 1,
  });
});

afterAll(async () => {
  for (const db of dbs) await terminate(db);
  for (const app of apps) await deleteApp(app);
});

describe('voice add through the relay', () => {
  it('adds each spoken item with a log entry, credited to the key’s owner', async () => {
    const res = await say(KEY, 'Add milk and two avocados to the list');
    expect(await res.text()).toBe('Added milk and avocados.');
    expect(res.status).toBe(200);

    const items = (await getDocs(collection(sam, 'households', HID, 'items'))).docs.map((d) =>
      d.data(),
    );
    const byName = Object.fromEntries(items.map((i) => [i.name, i]));
    expect(byName.Milk).toMatchObject({ createdBy: 'alex', via: 'voice', status: 'open', qty: 1 });
    expect(byName.Avocados).toMatchObject({ qty: 2, list: 'grocery', stores: ['ht'] });

    const log = (await getDocs(collection(sam, 'households', HID, 'activity'))).docs.map((d) =>
      d.data(),
    );
    const adds = log.filter((e) => e.detail === 'voice');
    expect(adds.map((e) => e.itemNames[0]).sort()).toEqual(['Avocados', 'Milk']);
    expect(adds.every((e) => e.actorId === 'alex' && e.type === 'add')).toBe(true);
  });

  it('skips what’s already on the list and says so, even right after a voice add', async () => {
    // The app keeps this snapshot; here it says only milk is on the list.
    await setDoc(doc(alex, 'households', HID, 'voiceOpen', sha(KEY)), {
      names: ['milk'],
      at: 1,
    });
    const first = await say(KEY, 'milk and bread');
    expect(await first.text()).toBe('Added bread. Milk is already on the list.');
    // No app has updated the snapshot since, but the add above noted bread on it.
    const again = await say(KEY, 'breads');
    expect(again.status).toBe(200);
    expect(await again.text()).toBe('Breads is already on the list.');
    const breads = (await getDocs(collection(sam, 'households', HID, 'items'))).docs.filter(
      (d) => d.data().name === 'Bread',
    );
    expect(breads).toHaveLength(1);
  });

  it('turns away a wrong, borrowed or removed key', async () => {
    const wrong = await say(`${HID}.alex.${'x'.repeat(40)}`, 'eggs');
    expect(wrong.status).toBe(403);
    // Alex's secret with Sam's id: the hash doesn't match a saved key.
    const borrowed = await say(`${HID}.sam.${'k'.repeat(40)}`, 'eggs');
    expect(borrowed.status).toBe(403);
    expect(await say('not-a-key', 'eggs').then((r) => r.status)).toBe(401);

    await deleteDoc(doc(sam, 'households', HID, 'voiceKeys', sha(KEY)));
    const removed = await say(KEY, 'eggs');
    expect(removed.status).toBe(403);
    expect(await removed.text()).toMatch(/doesn’t work anymore/);
  });

  it('says so when nothing was heard', async () => {
    const res = await say(KEY, '  ');
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('I didn’t catch any items.');
  });
});

describe('voice add rules', () => {
  it('only accepts open grocery items with a valid key, signed out', async () => {
    expect((await commit([voiceItem('ok1', KEY)])).status).toBe(200);
    expect((await commit([voiceItem('bad1', KEY, { status: s('checked') })])).status).toBe(403);
    expect((await commit([voiceItem('bad2', KEY, { createdBy: s('sam') })])).status).toBe(403);
    expect((await commit([voiceItem('bad3', `${HID}.alex.${'z'.repeat(40)}`)])).status).toBe(403);
    // Another household's id in the key.
    const other = `other-house.alex.${'k'.repeat(40)}`;
    expect((await commit([voiceItem('bad4', other)])).status).toBe(403);
  });

  it('won’t take a voice log entry without its item', async () => {
    const res = await commit([
      {
        update: {
          name: `${DOCS}/households/${HID}/activity/lonely`,
          fields: {
            actorId: s('alex'),
            type: s('add'),
            itemIds: { arrayValue: { values: [s('nope')] } },
            itemNames: { arrayValue: { values: [s('Nope')] } },
            detail: s('voice'),
            voiceKey: s(KEY),
          },
        },
        updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }],
      },
    ]);
    expect(res.status).toBe(403);
  });

  it('lets members save only their own key hashes, and never read them signed out', async () => {
    await expect(
      setDoc(doc(sam, 'households', HID, 'voiceKeys', sha('x')), {
        uid: 'alex',
        label: 'Not mine',
        createdAt: 1,
      }),
    ).rejects.toThrow();
    await expect(
      setDoc(doc(sam, 'households', HID, 'voiceKeys', 'not-a-hash'), {
        uid: 'sam',
        label: 'Bad id',
        createdAt: 1,
      }),
    ).rejects.toThrow();
    const res = await fetch(`${BASE}/${DOCS}/households/${HID}/voiceKeys`);
    expect(res.status).toBe(403);
  });

  it('shows the list snapshot signed out only to someone with the key', async () => {
    await setDoc(doc(alex, 'households', HID, 'voiceOpen', sha(KEY)), { names: ['milk'], at: 1 });
    const mine = await fetch(`${BASE}/${DOCS}/households/${HID}/voiceOpen/${sha(KEY)}`);
    expect(mine.status).toBe(200);
    const guess = await fetch(`${BASE}/${DOCS}/households/${HID}/voiceOpen/${sha('guess')}`);
    expect(guess.status).toBe(403);
    const all = await fetch(`${BASE}/${DOCS}/households/${HID}/voiceOpen`);
    expect(all.status).toBe(403);
    await expect(
      setDoc(doc(alex, 'households', HID, 'voiceOpen', sha(KEY)), { names: 'milk', at: 1 }),
    ).rejects.toThrow();
  });
});
