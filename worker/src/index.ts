/**
 * Fridgeboard push relay (Cloudflare Worker, free plan).
 *
 * POST /notify  { householdId, kind, title, body, actor?, items?, tag?, url? }
 *   Authorization: Bearer <Firebase ID token of the sender>
 *
 * The Worker holds no Google credentials. It reads the household's push subscriptions from
 * Firestore's REST API *with the sender's own ID token*, so Firestore security rules decide
 * whether the sender is a member. Then it sends Web Push to the other members' phones.
 */
import { importVapidPrivateKey, sendPush, type PushTarget, type Vapid } from './webpush';

export interface Env {
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  FIREBASE_PROJECT_ID: string;
  /** Comma-separated origins allowed to call the relay, e.g. https://fridgeboard.web.app */
  ALLOWED_ORIGINS: string;
  /** Override for the local Firestore emulator, e.g. http://127.0.0.1:8080/v1 */
  FIRESTORE_BASE?: string;
}

export const KINDS = ['adds', 'trip', 'test'] as const;
export type Kind = (typeof KINDS)[number];

interface NotifyRequest {
  householdId: string;
  kind: Kind;
  title: string;
  body: string;
  actor?: string;
  items?: string[];
  tag?: string;
  url?: string;
}

interface StoredSub extends PushTarget {
  id: string;
  name: string;
  uid: string;
  prefs: Partial<Record<Kind, boolean>>;
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  const ok = origin && (allowed.includes(origin) || allowed.includes('*'));
  return {
    'Access-Control-Allow-Origin': ok ? origin : (allowed[0] ?? ''),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(status: number, body: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Reads the uid from a token Firestore has already accepted. */
export function uidFromToken(token: string): string | null {
  try {
    const part = token.split('.')[1];
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.user_id === 'string'
      ? payload.user_id
      : typeof payload.sub === 'string'
        ? payload.sub
        : null;
  } catch {
    return null;
  }
}

type FsValue = {
  stringValue?: string;
  booleanValue?: boolean;
  mapValue?: { fields?: Record<string, FsValue> };
};

function parseSub(doc: { name: string; fields?: Record<string, FsValue> }): StoredSub | null {
  const f = doc.fields ?? {};
  const str = (k: string) => f[k]?.stringValue ?? '';
  const prefs: StoredSub['prefs'] = {};
  for (const [k, v] of Object.entries(f.prefs?.mapValue?.fields ?? {})) {
    if ((KINDS as readonly string[]).includes(k) && typeof v.booleanValue === 'boolean') {
      prefs[k as Kind] = v.booleanValue;
    }
  }
  const sub = {
    id: doc.name.split('/').pop() ?? '',
    name: doc.name,
    uid: str('uid'),
    endpoint: str('endpoint'),
    p256dh: str('p256dh'),
    auth: str('auth'),
    prefs,
  };
  return sub.endpoint.startsWith('https://') && sub.p256dh && sub.auth && sub.uid ? sub : null;
}

function validate(input: unknown): NotifyRequest | string {
  if (!input || typeof input !== 'object') return 'Body must be JSON';
  const r = input as Record<string, unknown>;
  if (typeof r.householdId !== 'string' || !/^[\w-]{1,64}$/.test(r.householdId))
    return 'householdId is required';
  if (!(KINDS as readonly string[]).includes(r.kind as string)) return 'kind is invalid';
  if (typeof r.title !== 'string' || !r.title.trim()) return 'title is required';
  const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  return {
    householdId: r.householdId,
    kind: r.kind as Kind,
    title: r.title.slice(0, 80),
    body: clip(r.body, 240) ?? '',
    actor: clip(r.actor, 40),
    items: Array.isArray(r.items)
      ? r.items
          .filter((i): i is string => typeof i === 'string')
          .slice(0, 20)
          .map((i) => i.slice(0, 60))
      : undefined,
    tag: clip(r.tag, 64),
    url: typeof r.url === 'string' && r.url.startsWith('/') ? r.url.slice(0, 200) : '/',
  };
}

export async function handle(
  request: Request,
  env: Env,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const cors = corsHeaders(request.headers.get('Origin'), env);
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (url.pathname === '/health') return json(200, { ok: true }, cors);
  if (url.pathname !== '/notify' || request.method !== 'POST')
    return json(404, { error: 'Not found' }, cors);

  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const uid = token ? uidFromToken(token) : null;
  if (!uid) return json(401, { error: 'Sign in first' }, cors);

  const parsed = validate(await request.json().catch(() => null));
  if (typeof parsed === 'string') return json(400, { error: parsed }, cors);

  const base = env.FIRESTORE_BASE ?? 'https://firestore.googleapis.com/v1';
  const subsUrl = `${base}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/households/${parsed.householdId}/pushSubs?pageSize=50`;
  const list = await fetchFn(subsUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (list.status === 401 || list.status === 403)
    return json(403, { error: 'Not a member of that household' }, cors);
  if (!list.ok) return json(502, { error: `Firestore returned ${list.status}` }, cors);
  const docs = ((await list.json()) as { documents?: { name: string }[] }).documents ?? [];
  const subs = docs.map(parseSub).filter((s): s is StoredSub => s !== null);

  // Tests go to the sender's own phones; everything else to the other members, if they opted in.
  const targets = subs.filter((s) =>
    parsed.kind === 'test' ? s.uid === uid : s.uid !== uid && s.prefs[parsed.kind] !== false,
  );

  const vapid: Vapid = {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: await importVapidPrivateKey(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY),
    subject: env.VAPID_SUBJECT,
  };
  const payload = {
    kind: parsed.kind,
    title: parsed.title,
    body: parsed.body,
    actor: parsed.actor,
    items: parsed.items,
    tag: parsed.tag ?? parsed.kind,
    url: parsed.url,
  };

  let sent = 0;
  let removed = 0;
  let failed = 0;
  await Promise.all(
    targets.map(async (t) => {
      try {
        const status = await sendPush(t, payload, vapid, fetchFn);
        if (status >= 200 && status < 300) sent += 1;
        else if (status === 404 || status === 410) {
          // The phone unsubscribed or reinstalled: clean up so we stop trying.
          removed += 1;
          await fetchFn(`${base}/${t.name}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
        } else failed += 1;
      } catch {
        failed += 1;
      }
    }),
  );
  return json(200, { sent, removed, failed, targets: targets.length }, cors);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
