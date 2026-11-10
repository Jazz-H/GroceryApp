// The push relay against the real Firestore emulator: REST parsing, the sender's token, and rules.
import { createECDH, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  setDoc,
  terminate,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
// @ts-expect-error: no types
import ece from 'http_ece';
import { handle, type Env } from '../worker/src/index';
import { bytesToB64url } from '../worker/src/webpush';

const PROJECT = 'demo-fridgeboard';
const HID = 'relay-house';
const apps: ReturnType<typeof initializeApp>[] = [];
const dbs: Firestore[] = [];

function client(uid: string) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'x' }, `relay-${uid}`);
  apps.push(app);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080, { mockUserToken: { user_id: uid } });
  dbs.push(db);
  return db;
}

/** Same unsigned token shape the SDK sends to the emulator. */
function emulatorToken(uid: string) {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    iat: now,
    exp: now + 3600,
    auth_time: now,
    sub: uid,
    user_id: uid,
    firebase: { sign_in_provider: 'google.com', identities: {} },
  })}.`;
}

const samPhone = createECDH('prime256v1');
samPhone.generateKeys();
const samAuth = randomBytes(16);
let env: Env;

beforeAll(async () => {
  await fetch(
    `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  const alex = client('alex');
  const sam = client('sam');
  const b = writeBatch(alex);
  b.set(doc(alex, 'households', HID), {
    name: 'Relay test',
    memberIds: ['alex'],
    members: { alex: { name: 'Alex', color: '#0f8a7e' } },
    inviteCode: 'RELAY2',
    zip: '28262',
    zoneOrder: {},
  });
  b.set(doc(alex, 'invites', 'RELAY2'), { householdId: HID, createdBy: 'alex' });
  await b.commit();
  const { arrayUnion, updateDoc } = await import('firebase/firestore');
  await updateDoc(doc(sam, 'households', HID), {
    memberIds: arrayUnion('sam'),
    'members.sam': { name: 'Sam', color: '#d4466a' },
    joinCode: 'RELAY2',
  });
  await setDoc(doc(sam, 'households', HID, 'pushSubs', 'samphone'), {
    uid: 'sam',
    endpoint: 'https://push.example.com/sam-phone',
    p256dh: bytesToB64url(samPhone.getPublicKey()),
    auth: bytesToB64url(samAuth),
    prefs: { adds: true, trip: true },
    device: 'iPhone',
  });

  const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ])) as CryptoKeyPair;
  env = {
    VAPID_PUBLIC_KEY: bytesToB64url(
      new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)),
    ),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', keys.privateKey)).d!,
    VAPID_SUBJECT: 'mailto:test@example.com',
    FIREBASE_PROJECT_ID: PROJECT,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    FIRESTORE_BASE: 'http://127.0.0.1:8080/v1',
  };
});

afterAll(async () => {
  for (const db of dbs) await terminate(db);
  for (const app of apps) await deleteApp(app);
});

/** Real fetch for Firestore, captured for the push service. */
function network() {
  const pushes: Uint8Array[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://push.example.com/')) {
      pushes.push(new Uint8Array(init!.body as ArrayBuffer));
      return new Response('', { status: 201 });
    }
    return fetch(input, init);
  }) as typeof fetch;
  return { fetchFn, pushes };
}

const request = (uid: string) =>
  new Request('https://relay/notify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${emulatorToken(uid)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      householdId: HID,
      kind: 'trip_start',
      data: { store: 'target', mode: 'solo', open: 2 },
    }),
  });

describe('push relay with the Firestore emulator', () => {
  it('reads subscriptions with the sender token and delivers to the partner', async () => {
    const net = network();
    const res = await handle(request('alex'), env, net.fetchFn);
    expect(await res.json()).toEqual({ sent: 1, removed: 0, failed: 0, targets: 1 });
    const plain = ece.decrypt(Buffer.from(net.pushes[0]), {
      version: 'aes128gcm',
      privateKey: samPhone,
      authSecret: samAuth,
    });
    expect(JSON.parse(plain.toString())).toMatchObject({
      title: 'Alex is at Target',
      body: 'Shopping solo with 2 items. Add anything you need now.',
      kind: 'trip_start',
      actor: 'Alex',
      url: '/#list/target',
    });
  });

  it('refuses someone outside the household (rules deny the read)', async () => {
    const net = network();
    const res = await handle(request('mallory'), env, net.fetchFn);
    expect(res.status).toBe(403);
    expect(net.pushes).toHaveLength(0);
  });
});
