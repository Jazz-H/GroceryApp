import { createECDH, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: no types
import ece from 'http_ece';
import { handle, uidFromToken, type Env } from './index';
import { bytesToB64url } from './webpush';

const unsignedToken = (uid: string) =>
  `${btoa(JSON.stringify({ alg: 'none' }))}.${btoa(JSON.stringify({ user_id: uid, sub: uid }))}.`;

async function makeEnv(): Promise<Env> {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ])) as CryptoKeyPair;
  return {
    VAPID_PUBLIC_KEY: bytesToB64url(
      new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)),
    ),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', keys.privateKey)).d!,
    VAPID_SUBJECT: 'mailto:test@example.com',
    FIREBASE_PROJECT_ID: 'demo',
    ALLOWED_ORIGINS: 'https://demo.web.app',
  };
}

function phone(uid: string, prefs: Record<string, boolean> = {}) {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  const id = `${uid}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    ua,
    auth,
    endpoint: `https://push.example.com/${id}`,
    doc: {
      name: `projects/demo/databases/(default)/documents/households/h1/pushSubs/${id}`,
      fields: {
        uid: { stringValue: uid },
        endpoint: { stringValue: `https://push.example.com/${id}` },
        p256dh: { stringValue: bytesToB64url(ua.getPublicKey()) },
        auth: { stringValue: bytesToB64url(auth) },
        prefs: {
          mapValue: {
            fields: Object.fromEntries(
              Object.entries(prefs).map(([k, v]) => [k, { booleanValue: v }]),
            ),
          },
        },
      },
    },
  };
}

function fakeNetwork(
  phones: ReturnType<typeof phone>[],
  opts: { firestoreStatus?: number; goneEndpoints?: string[] } = {},
) {
  const pushes: { endpoint: string; body: Uint8Array; headers: Headers }[] = [];
  const deletes: string[] = [];
  const firestoreAuth: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('firestore.googleapis.com')) {
      firestoreAuth.push(new Headers(init?.headers).get('Authorization') ?? '');
      if (init?.method === 'DELETE') {
        deletes.push(url);
        return new Response('{}');
      }
      if (opts.firestoreStatus) return new Response('{}', { status: opts.firestoreStatus });
      return new Response(JSON.stringify({ documents: phones.map((p) => p.doc) }));
    }
    pushes.push({
      endpoint: url,
      body: new Uint8Array(init!.body as ArrayBuffer),
      headers: new Headers(init?.headers),
    });
    return new Response('', { status: opts.goneEndpoints?.includes(url) ? 410 : 201 });
  }) as typeof fetch;
  return { fetchFn, pushes, deletes, firestoreAuth };
}

function notify(token: string | null, body: object) {
  return new Request('https://relay.example.com/notify', {
    method: 'POST',
    headers: {
      Origin: 'https://demo.web.app',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const msg = {
  householdId: 'h1',
  kind: 'adds',
  title: 'Alex added 2 items',
  body: 'Eggs, Milk',
  actor: 'Alex',
  items: ['Eggs', 'Milk'],
};

describe('push relay', () => {
  it('sends an encrypted push to the other member only, readable by their phone', async () => {
    const env = await makeEnv();
    const alex = phone('alex');
    const sam = phone('sam');
    const net = fakeNetwork([alex, sam]);
    const token = unsignedToken('alex');
    const res = await handle(notify(token, msg), env, net.fetchFn);
    expect(await res.json()).toEqual({ sent: 1, removed: 0, failed: 0, targets: 1 });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://demo.web.app');
    expect(net.firestoreAuth[0]).toBe(`Bearer ${token}`); // reads with the sender's own token
    expect(net.pushes).toHaveLength(1);
    expect(net.pushes[0].endpoint).toBe(sam.endpoint);
    expect(net.pushes[0].headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(net.pushes[0].headers.get('Authorization')).toMatch(/^vapid t=.+, k=.+$/);
    const plain = ece.decrypt(Buffer.from(net.pushes[0].body), {
      version: 'aes128gcm',
      privateKey: sam.ua,
      authSecret: sam.auth,
    });
    expect(JSON.parse(plain.toString())).toMatchObject({
      kind: 'adds',
      title: 'Alex added 2 items',
      items: ['Eggs', 'Milk'],
      url: '/',
    });
  });

  it('respects a phone that turned a kind off', async () => {
    const env = await makeEnv();
    const net = fakeNetwork([phone('alex'), phone('sam', { adds: false, trip: true })]);
    const res = await handle(notify(unsignedToken('alex'), msg), env, net.fetchFn);
    expect((await res.json()).targets).toBe(0);
    const trip = await handle(
      notify(unsignedToken('alex'), { ...msg, kind: 'trip', title: 'Alex is at Target' }),
      env,
      net.fetchFn,
    );
    expect((await trip.json()).sent).toBe(1);
  });

  it('sends test notifications to your own phones', async () => {
    const env = await makeEnv();
    const alex = phone('alex');
    const net = fakeNetwork([alex, phone('sam')]);
    await handle(
      notify(unsignedToken('alex'), { ...msg, kind: 'test', title: 'Test' }),
      env,
      net.fetchFn,
    );
    expect(net.pushes.map((p) => p.endpoint)).toEqual([alex.endpoint]);
  });

  it('removes subscriptions the push service says are gone', async () => {
    const env = await makeEnv();
    const sam = phone('sam');
    const net = fakeNetwork([sam], { goneEndpoints: [sam.endpoint] });
    const res = await handle(notify(unsignedToken('alex'), msg), env, net.fetchFn);
    expect(await res.json()).toMatchObject({ sent: 0, removed: 1 });
    expect(net.deletes[0]).toContain(sam.doc.name);
  });

  it('refuses non-members and signed-out callers', async () => {
    const env = await makeEnv();
    const denied = fakeNetwork([], { firestoreStatus: 403 });
    expect((await handle(notify(unsignedToken('mallory'), msg), env, denied.fetchFn)).status).toBe(
      403,
    );
    expect((await handle(notify(null, msg), env, denied.fetchFn)).status).toBe(401);
  });

  it('validates input', async () => {
    const env = await makeEnv();
    const net = fakeNetwork([]);
    const res = await handle(
      notify(unsignedToken('alex'), { ...msg, kind: 'spam' }),
      env,
      net.fetchFn,
    );
    expect(res.status).toBe(400);
  });

  it('answers CORS preflight', async () => {
    const env = await makeEnv();
    const res = await handle(
      new Request('https://relay.example.com/notify', {
        method: 'OPTIONS',
        headers: { Origin: 'https://demo.web.app' },
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('reads the uid from a Firebase token', () => {
    expect(uidFromToken(unsignedToken('sam'))).toBe('sam');
    expect(uidFromToken('garbage')).toBeNull();
  });
});
