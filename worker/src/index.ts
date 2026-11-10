/**
 * Stocked push relay (Cloudflare Worker, free plan).
 *
 * POST /notify  { householdId, kind, data }
 *   Authorization: Bearer <Firebase ID token of the sender>
 *
 * The Worker holds no Google credentials. It reads the household and its push subscriptions
 * from Firestore's REST API *with the sender's own ID token*, so Firestore security rules decide
 * whether the sender is a member. It writes the notification text itself (see messages.ts) and
 * sends Web Push to the other current members' phones, skipping snoozed phones and quiet hours.
 */
import { cleanData, compose, KINDS, PREF_FOR, PREFS, type Kind, type Pref } from './messages';
import { importVapidPrivateKey, sendPush, type PushTarget, type Vapid } from './webpush';

export { KINDS };

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

interface Quiet {
  start: number;
  end: number;
  tz: string;
}

interface StoredSub extends PushTarget {
  id: string;
  name: string;
  uid: string;
  prefs: Partial<Record<Pref, boolean>>;
  mutedUntil: number;
  quiet: Quiet | null;
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim());
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

/** Reads the uid from a token Firestore will check on every read the relay makes with it. */
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

// ---------- Rate limit (per relay instance; enough to stop a runaway loop) ----------

const WINDOW_MS = 10 * 60_000;
const LIMITS: Record<'test' | 'other', number> = { test: 5, other: 60 };
const sentAt = new Map<string, number[]>();

export function resetRateLimits() {
  sentAt.clear();
}

/** True if this sender may send another notification of this kind now. */
export function allow(uid: string, kind: Kind, now: number): boolean {
  const key = `${uid}:${kind === 'test' ? 'test' : 'other'}`;
  const recent = (sentAt.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMITS[kind === 'test' ? 'test' : 'other']) {
    sentAt.set(key, recent);
    return false;
  }
  recent.push(now);
  sentAt.set(key, recent);
  return true;
}

// ---------- Firestore REST parsing ----------

type FsValue = {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  arrayValue?: { values?: FsValue[] };
  mapValue?: { fields?: Record<string, FsValue> };
};

const num = (v: FsValue | undefined): number =>
  v?.integerValue !== undefined
    ? Number(v.integerValue)
    : v?.doubleValue !== undefined
      ? v.doubleValue
      : v?.timestampValue
        ? Date.parse(v.timestampValue)
        : 0;

export function parseSub(doc: {
  name: string;
  fields?: Record<string, FsValue>;
}): StoredSub | null {
  const f = doc.fields ?? {};
  const str = (k: string) => f[k]?.stringValue ?? '';
  const prefs: StoredSub['prefs'] = {};
  for (const [k, v] of Object.entries(f.prefs?.mapValue?.fields ?? {})) {
    if ((PREFS as readonly string[]).includes(k) && typeof v.booleanValue === 'boolean')
      prefs[k as Pref] = v.booleanValue;
  }
  const q = f.quiet?.mapValue?.fields;
  const quiet =
    q && q.tz?.stringValue ? { start: num(q.start), end: num(q.end), tz: q.tz.stringValue } : null;
  const sub = {
    id: doc.name.split('/').pop() ?? '',
    name: doc.name,
    uid: str('uid'),
    endpoint: str('endpoint'),
    p256dh: str('p256dh'),
    auth: str('auth'),
    prefs,
    mutedUntil: num(f.mutedUntil),
    quiet,
  };
  return sub.endpoint.startsWith('https://') && sub.p256dh && sub.auth && sub.uid ? sub : null;
}

function parseHousehold(doc: { fields?: Record<string, FsValue> }) {
  const f = doc.fields ?? {};
  const memberIds = (f.memberIds?.arrayValue?.values ?? [])
    .map((v) => v.stringValue ?? '')
    .filter(Boolean);
  const names: Record<string, string> = {};
  for (const [id, m] of Object.entries(f.members?.mapValue?.fields ?? {}))
    names[id] = m.mapValue?.fields?.name?.stringValue ?? '';
  return { memberIds, names };
}

/** The local hour (0–23) in a time zone, or null if the zone isn't valid. */
function localHour(now: number, tz: string): number | null {
  try {
    const h = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: tz,
    }).format(now);
    return Number(h) % 24;
  } catch {
    return null;
  }
}

/** Inside a quiet-hours window like 22→7 (wraps midnight) or 13→15. */
export function inQuietHours(quiet: Quiet | null, now: number): boolean {
  if (!quiet || quiet.start === quiet.end) return false;
  const h = localHour(now, quiet.tz);
  if (h === null) return false;
  return quiet.start < quiet.end
    ? h >= quiet.start && h < quiet.end
    : h >= quiet.start || h < quiet.end;
}

// ---------- Request ----------

interface NotifyRequest {
  householdId: string;
  kind: Kind;
  data: ReturnType<typeof cleanData>;
}

function validate(input: unknown): NotifyRequest | string {
  if (!input || typeof input !== 'object') return 'Body must be JSON';
  const r = input as Record<string, unknown>;
  if (typeof r.householdId !== 'string' || !/^[\w-]{1,64}$/.test(r.householdId))
    return 'householdId is required';
  // Older app versions sent kind "trip" with the details at the top level.
  const kind = r.kind === 'trip' ? 'trip_start' : r.kind;
  if (!(KINDS as readonly string[]).includes(kind as string)) return 'kind is invalid';
  return {
    householdId: r.householdId,
    kind: kind as Kind,
    data: cleanData(r.data && typeof r.data === 'object' ? r.data : r),
  };
}

export async function handle(
  request: Request,
  env: Env,
  fetchFn: typeof fetch = fetch,
  now = Date.now(),
): Promise<Response> {
  const cors = corsHeaders(request.headers.get('Origin'), env);
  const configured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  // Push services accept an https: URL as the VAPID subject; fall back to the app's own.
  const subject =
    env.VAPID_SUBJECT?.trim() ||
    (env.ALLOWED_ORIGINS ?? '').split(',')[0]?.trim() ||
    'https://fridgeboard-642b9.web.app';
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (url.pathname === '/health') return json(200, { ok: configured, configured }, cors);
  if (url.pathname !== '/notify' || request.method !== 'POST')
    return json(404, { error: 'Not found' }, cors);
  if (!configured)
    return json(
      500,
      { error: 'The relay is missing its VAPID keys.', code: 'not-configured' },
      cors,
    );

  try {
    const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const uid = token ? uidFromToken(token) : null;
    if (!uid) return json(401, { error: 'Sign in first' }, cors);

    const parsed = validate(await request.json().catch(() => null));
    if (typeof parsed === 'string') return json(400, { error: parsed }, cors);
    if (!allow(uid, parsed.kind, now))
      return json(
        429,
        { error: 'Too many notifications. Try again in a few minutes.', code: 'rate-limited' },
        cors,
      );

    const base = env.FIRESTORE_BASE ?? 'https://firestore.googleapis.com/v1';
    const hhPath = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/households/${parsed.householdId}`;
    const authz = { headers: { Authorization: `Bearer ${token}` } };

    const hh = await fetchFn(`${base}/${hhPath}`, authz);
    if (hh.status === 401 || hh.status === 403 || hh.status === 404)
      return json(403, { error: 'Not a member of that household' }, cors);
    if (!hh.ok) return json(502, { error: `Firestore returned ${hh.status}` }, cors);
    const { memberIds, names } = parseHousehold(await hh.json());
    if (!memberIds.includes(uid))
      return json(403, { error: 'Not a member of that household' }, cors);

    const list = await fetchFn(`${base}/${hhPath}/pushSubs?pageSize=50`, authz);
    if (!list.ok) return json(502, { error: `Firestore returned ${list.status}` }, cors);
    const docs = ((await list.json()) as { documents?: { name: string }[] }).documents ?? [];
    // Phones of people who have left the household get nothing.
    const subs = docs
      .map(parseSub)
      .filter((s): s is StoredSub => s !== null && memberIds.includes(s.uid));

    const kind = parsed.kind;
    const targets = subs.filter((s) =>
      kind === 'test'
        ? s.uid === uid
        : s.uid !== uid &&
          s.prefs[PREF_FOR[kind]] !== false &&
          !(s.mutedUntil > now) &&
          !inQuietHours(s.quiet, now),
    );

    const actor = names[uid]?.trim() || 'Your partner';
    const message = compose(kind, parsed.data, actor, uid);
    const payload = { kind, actor, ...message };

    const vapid: Vapid = {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: await importVapidPrivateKey(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY),
      subject,
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
            await fetchFn(`${base}/${t.name}`, { method: 'DELETE', ...authz });
          } else failed += 1;
        } catch {
          failed += 1;
        }
      }),
    );
    return json(200, { sent, removed, failed, targets: targets.length }, cors);
  } catch (e) {
    // Always answer with CORS headers so the app can show what went wrong.
    return json(500, { error: `Relay error: ${(e as Error).message}`, code: 'relay-error' }, cors);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
