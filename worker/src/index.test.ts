import { createECDH, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error: no types
import ece from 'http_ece';
import { handle, inQuietHours, resetRateLimits, uidFromToken, type Env } from './index';
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

type Extra = Record<string, unknown>;

function phone(uid: string, prefs: Record<string, boolean> = {}, extra: Extra = {}) {
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
        ...extra,
      },
    },
  };
}

const household = (members: Record<string, string>) => ({
  name: 'projects/demo/databases/(default)/documents/households/h1',
  fields: {
    memberIds: { arrayValue: { values: Object.keys(members).map((m) => ({ stringValue: m })) } },
    members: {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(members).map(([id, name]) => [
            id,
            { mapValue: { fields: { name: { stringValue: name } } } },
          ]),
        ),
      },
    },
  },
});

function fakeNetwork(
  phones: ReturnType<typeof phone>[],
  opts: {
    firestoreStatus?: number;
    goneEndpoints?: string[];
    members?: Record<string, string>;
  } = {},
) {
  const members = opts.members ?? { alex: 'Alex', sam: 'Sam' };
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
      if (url.endsWith('/households/h1')) return new Response(JSON.stringify(household(members)));
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

const msg = { householdId: 'h1', kind: 'adds', data: { items: ['Eggs', 'Milk'], count: 2 } };

function decrypt(push: { body: Uint8Array }, p: ReturnType<typeof phone>) {
  const plain = ece.decrypt(Buffer.from(push.body), {
    version: 'aes128gcm',
    privateKey: p.ua,
    authSecret: p.auth,
  });
  return JSON.parse(plain.toString());
}

beforeEach(() => resetRateLimits());

describe('push relay', () => {
  it('sends an encrypted push to the other member only, with text written by the relay', async () => {
    const env = await makeEnv();
    const alex = phone('alex');
    const sam = phone('sam');
    const net = fakeNetwork([alex, sam]);
    const token = unsignedToken('alex');
    // A client-supplied title is ignored.
    const res = await handle(notify(token, { ...msg, title: 'Free money!' }), env, net.fetchFn);
    expect(await res.json()).toEqual({ sent: 1, removed: 0, failed: 0, targets: 1 });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://demo.web.app');
    expect(net.firestoreAuth[0]).toBe(`Bearer ${token}`); // reads with the sender's own token
    expect(net.pushes).toHaveLength(1);
    expect(net.pushes[0].endpoint).toBe(sam.endpoint);
    expect(net.pushes[0].headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(net.pushes[0].headers.get('Authorization')).toMatch(/^vapid t=.+, k=.+$/);
    expect(decrypt(net.pushes[0], sam)).toMatchObject({
      kind: 'adds',
      actor: 'Alex',
      title: 'Alex added 2 items',
      body: 'Eggs, Milk',
      items: ['Eggs', 'Milk'],
      count: 2,
      tag: 'adds-alex',
      url: '/#list',
    });
  });

  it('writes every kind of message and deep-links to the right screen', async () => {
    const env = await makeEnv();
    const sam = phone('sam');
    const net = fakeNetwork([sam]);
    const send = (kind: string, data: object) =>
      handle(notify(unsignedToken('alex'), { householdId: 'h1', kind, data }), env, net.fetchFn);
    await send('trip_start', { store: 'target', mode: 'solo', open: 3 });
    await send('trip_join', { store: 'ht' });
    await send('trip_end', { store: 'ht', checked: 12 });
    await send('receipt', { store: 'target', cents: 16260 });
    await send('budget', { pct: 100, cents: 61234, budgetCents: 60000, month: 'November' });
    await send('trip', { store: 'amazon', mode: 'together', open: 1 }); // older app version
    expect(net.pushes.map((p) => decrypt(p, sam)).map((m) => [m.title, m.body, m.url])).toEqual([
      [
        'Alex is at Target',
        'Shopping solo with 3 items. Add anything you need now.',
        '/#list/target',
      ],
      ['Alex joined your Harris Teeter trip', 'You’re shopping together now.', '/#list/ht'],
      ['Alex finished at Harris Teeter', '12 items checked off.', '/#list'],
      ['Alex saved a Target receipt', '$162.60 added to spending.', '/#spend'],
      ['November is over budget', '$612.34 of $600.00 spent.', '/#spend'],
      ['Alex is at Amazon', 'Shopping together. 1 item on the list.', '/#list/amazon'],
    ]);
  });

  it('respects a phone that turned a kind off', async () => {
    const env = await makeEnv();
    const net = fakeNetwork([phone('alex'), phone('sam', { adds: false, trip: true })]);
    const res = await handle(notify(unsignedToken('alex'), msg), env, net.fetchFn);
    expect((await res.json()).targets).toBe(0);
    const trip = await handle(
      notify(unsignedToken('alex'), { householdId: 'h1', kind: 'trip_start', data: {} }),
      env,
      net.fetchFn,
    );
    expect((await trip.json()).sent).toBe(1);
  });

  it('skips snoozed phones and phones in quiet hours', async () => {
    const env = await makeEnv();
    const now = Date.parse('2026-11-10T03:00:00Z'); // 10pm in New York
    const snoozed = phone('sam', {}, { mutedUntil: { integerValue: String(now + 60_000) } });
    const quiet = phone(
      'sam',
      {},
      {
        quiet: {
          mapValue: {
            fields: {
              start: { integerValue: '22' },
              end: { integerValue: '7' },
              tz: { stringValue: 'America/New_York' },
            },
          },
        },
      },
    );
    const awake = phone('sam', {}, { mutedUntil: { integerValue: String(now - 1) } });
    const net = fakeNetwork([snoozed, quiet, awake]);
    const res = await handle(notify(unsignedToken('alex'), msg), env, net.fetchFn, now);
    expect((await res.json()).targets).toBe(1);
    expect(net.pushes.map((p) => p.endpoint)).toEqual([awake.endpoint]);
  });

  it('works out quiet hours across midnight and in the daytime', () => {
    const q = (start: number, end: number) => ({ start, end, tz: 'UTC' });
    const at = (h: number) => Date.UTC(2026, 10, 10, h, 30);
    expect(inQuietHours(q(22, 7), at(23))).toBe(true);
    expect(inQuietHours(q(22, 7), at(3))).toBe(true);
    expect(inQuietHours(q(22, 7), at(7))).toBe(false);
    expect(inQuietHours(q(13, 15), at(14))).toBe(true);
    expect(inQuietHours(q(13, 15), at(16))).toBe(false);
    expect(inQuietHours({ start: 1, end: 5, tz: 'Not/AZone' }, at(3))).toBe(false);
    expect(inQuietHours(null, at(3))).toBe(false);
  });

  it('ignores phones of people who left the household', async () => {
    const env = await makeEnv();
    const exMember = phone('pat');
    const sam = phone('sam');
    const net = fakeNetwork([exMember, sam]);
    await handle(notify(unsignedToken('alex'), msg), env, net.fetchFn);
    expect(net.pushes.map((p) => p.endpoint)).toEqual([sam.endpoint]);
  });

  it('sends test notifications to your own phones', async () => {
    const env = await makeEnv();
    const alex = phone('alex');
    const net = fakeNetwork([alex, phone('sam')]);
    await handle(
      notify(unsignedToken('alex'), { householdId: 'h1', kind: 'test' }),
      env,
      net.fetchFn,
    );
    expect(net.pushes.map((p) => p.endpoint)).toEqual([alex.endpoint]);
  });

  it('sends the monthly recap to everyone, sender included', async () => {
    const env = await makeEnv();
    const alex = phone('alex');
    const sam = phone('sam');
    const muted = phone('sam', { recap: false });
    const net = fakeNetwork([alex, sam, muted]);
    await handle(
      notify(unsignedToken('alex'), {
        householdId: 'h1',
        kind: 'recap',
        data: {
          month: 'October',
          cents: 66876,
          receipts: 6,
          topStore: 'target',
          topCents: 66876,
          budgetCents: 60000,
        },
      }),
      env,
      net.fetchFn,
    );
    expect(net.pushes.map((p) => p.endpoint).sort()).toEqual([alex.endpoint, sam.endpoint].sort());
    expect(
      decrypt(
        net.pushes.find((p) => p.endpoint === sam.endpoint)!,
        sam,
      ),
    ).toMatchObject({
      title: 'October recap: $668.76 on groceries',
      body: '6 receipts · most at Target ($668.76) · $68.76 over budget',
      url: '/#spend',
    });
  });

  it('rate-limits a sender', async () => {
    const env = await makeEnv();
    const net = fakeNetwork([phone('alex')]);
    const statuses = [];
    for (let i = 0; i < 6; i++)
      statuses.push(
        (
          await handle(
            notify(unsignedToken('alex'), { householdId: 'h1', kind: 'test' }),
            env,
            net.fetchFn,
          )
        ).status,
      );
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
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
    const notListed = fakeNetwork([phone('sam')], { members: { sam: 'Sam' } });
    expect(
      (await handle(notify(unsignedToken('mallory'), msg), env, notListed.fetchFn)).status,
    ).toBe(403);
    expect((await handle(notify(null, msg), env, denied.fetchFn)).status).toBe(401);
  });

  it('says clearly when the relay is missing its keys, with CORS headers', async () => {
    const env = { ...(await makeEnv()), VAPID_PUBLIC_KEY: '' };
    const res = await handle(notify(unsignedToken('alex'), msg), env, fakeNetwork([]).fetchFn);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'not-configured' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://demo.web.app');
    const health = await handle(new Request('https://relay.example.com/health'), env);
    expect(await health.json()).toEqual({ ok: false, configured: false });
  });

  it('turns unexpected errors into a 500 with CORS headers', async () => {
    const env = { ...(await makeEnv()), VAPID_PRIVATE_KEY: 'not-a-key' };
    const res = await handle(
      notify(unsignedToken('alex'), msg),
      env,
      fakeNetwork([phone('sam')]).fetchFn,
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'relay-error' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://demo.web.app');
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

  it('reads a recipe link for a signed-in user', async () => {
    const env = await makeEnv();
    const calls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('firestore.googleapis.com')) return new Response('{}');
      return new Response(
        '<script type="application/ld+json">{"@type":"Recipe","name":"Tacos","recipeIngredient":["1 lb beef","8 tortillas"]}</script>',
      );
    }) as typeof fetch;
    const req = (token: string | null, url: string) =>
      new Request('https://relay.example.com/recipe', {
        method: 'POST',
        headers: {
          Origin: 'https://demo.web.app',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ url }),
      });
    const ok = await handle(
      req(unsignedToken('alex'), 'https://cooking.example.com/tacos'),
      env,
      fetchFn,
    );
    expect(await ok.json()).toEqual({
      title: 'Tacos',
      ingredients: ['1 lb beef', '8 tortillas'],
      text: '',
    });
    expect(calls[0]).toContain('/documents/users/alex');
    expect((await handle(req(null, 'https://x.com'), env, fetchFn)).status).toBe(401);
    expect(
      (await handle(req(unsignedToken('alex'), 'http://127.0.0.1/'), env, fetchFn)).status,
    ).toBe(400);
  });

  it('reads the uid from a Firebase token', () => {
    expect(uidFromToken(unsignedToken('sam'))).toBe('sam');
    expect(uidFromToken('garbage')).toBeNull();
  });
});
