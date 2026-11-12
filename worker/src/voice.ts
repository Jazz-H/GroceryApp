/**
 * POST /add { key, text } — voice add from a Siri Shortcut (or any HTTP shortcut app).
 *
 * `key` is a member's voice key, "<householdId>.<uid>.<secret>", made in Stocked's settings.
 * The relay still holds no Google credentials: it writes to Firestore's REST API *signed out*,
 * and the security rules accept the write only if the key's SHA-256 is one the member saved
 * (see voiceAdd in firestore.rules). Answers in plain text, so the Shortcut can speak it.
 *
 * Repeats are skipped: the app keeps voiceOpen/{sha256(key)} listing what's on the Grocery list,
 * the relay reads it first, and each voice add appends its name there in the same commit.
 */
import { normalizeName } from '../../src/lib/text';
import { parseSpoken, splitDuplicates, spokenReply } from '../../src/lib/voice';

export interface VoiceEnv {
  FIREBASE_PROJECT_ID: string;
  FIRESTORE_BASE?: string;
}

const KEY_RE = /^([\w-]{1,64})\.([\w-]{1,128})\.([\w-]{32,100})$/;

const WINDOW_MS = 10 * 60_000;
const LIMIT = 30;
const addsAt = new Map<string, number[]>();

export function resetVoiceLimits() {
  addsAt.clear();
}

const keyGone = () =>
  text(403, 'That voice key doesn’t work anymore. Make a new one in Stocked’s settings.');

function text(status: number, body: string) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

type Fs =
  | { stringValue: string }
  | { integerValue: string }
  | { arrayValue: { values: Fs[] } }
  | { mapValue: { fields: Record<string, Fs> } };

const str = (s: string): Fs => ({ stringValue: s });
const strs = (a: string[]): Fs => ({ arrayValue: { values: a.map(str) } });

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, 'A')
    .replace(/\//g, 'B')
    .replace(/=+$/, '');
}

async function readBody(request: Request): Promise<{ key: string; text: string } | null> {
  const type = request.headers.get('Content-Type') ?? '';
  try {
    if (type.includes('application/json')) {
      const b = (await request.json()) as Record<string, unknown>;
      return { key: String(b.key ?? ''), text: String(b.text ?? '') };
    }
    const form = new URLSearchParams(await request.text());
    return { key: form.get('key') ?? '', text: form.get('text') ?? '' };
  } catch {
    return null;
  }
}

export async function handleVoiceAdd(
  request: Request,
  env: VoiceEnv,
  fetchFn: typeof fetch = fetch,
  now = Date.now(),
): Promise<Response> {
  const body = await readBody(request);
  if (!body) return text(400, 'Send JSON like {"key": "…", "text": "milk and eggs"}.');
  const m = KEY_RE.exec(body.key.trim());
  if (!m) return text(401, 'That voice key isn’t right. Copy it again from Stocked’s settings.');
  const [key, hid, uid] = m;

  const recent = (addsAt.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) return text(429, 'That’s a lot of adds. Try again in a few minutes.');
  recent.push(now);
  addsAt.set(key, recent);

  const spoken = parseSpoken(body.text.slice(0, 500));
  if (!spoken.length) return text(400, spokenReply([], []));

  const base = env.FIRESTORE_BASE ?? 'https://firestore.googleapis.com/v1';
  const db = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const hh = `${db}/households/${hid}`;
  const batchId = randomId().slice(0, 8);
  const openPath = `${hh}/voiceOpen/${await sha256Hex(key)}`;

  // What's already on the list. Missing (no app has written it yet) means: add everything.
  const open = await fetchFn(`${base}/${openPath}`);
  if (open.status === 401 || open.status === 403) return keyGone();
  const onList =
    open.status === 200
      ? (
          ((await open.json()) as { fields?: { names?: { arrayValue?: { values?: Fs[] } } } })
            .fields?.names?.arrayValue?.values ?? []
        )
          .map((v) => ('stringValue' in v ? v.stringValue : ''))
          .filter(Boolean)
      : [];
  const { fresh: items, already } = splitDuplicates(spoken, onList);
  const skipped = already.map((q) => q.name);
  if (!items.length) return text(200, spokenReply([], skipped));

  const results = await Promise.all(
    items.map(async (item) => {
      const id = randomId();
      const name = item.name.slice(0, 120);
      const writes = [
        {
          update: {
            name: `${hh}/items/${id}`,
            fields: {
              name: str(name),
              normalizedName: str(normalizeName(name)),
              list: str('grocery'),
              qty: { integerValue: String(Math.min(999, Math.max(1, item.qty))) },
              unit: str(''),
              note: str(''),
              stores: strs(['ht']),
              storeInfo: { mapValue: { fields: {} } },
              status: str('open'),
              createdBy: str(uid),
              updatedBy: str(uid),
              via: str('voice'),
              voiceKey: str(key),
            },
          },
          currentDocument: { exists: false },
          updateTransforms: [
            { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
        },
        {
          update: {
            name: `${hh}/activity/${randomId()}`,
            fields: {
              actorId: str(uid),
              type: str('add'),
              itemIds: strs([id]),
              itemNames: strs([name]),
              batchId: str(batchId),
              store: str('ht'),
              detail: str('voice'),
              voiceKey: str(key),
            },
          },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }],
        },
        {
          // Note it on the list snapshot, so saying it again before any app opens is caught.
          update: { name: openPath, fields: {} },
          updateMask: { fieldPaths: [] },
          updateTransforms: [
            { fieldPath: 'names', appendMissingElements: { values: [str(normalizeName(name))] } },
            { fieldPath: 'at', setToServerValue: 'REQUEST_TIME' },
          ],
        },
      ];
      const res = await fetchFn(`${base}/${db}:commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes }),
      });
      return { name, status: res.status };
    }),
  );

  const added = results.filter((r) => r.status === 200).map((r) => r.name);
  if (!added.length) {
    const denied = results.some((r) => r.status === 403 || r.status === 401);
    return denied ? keyGone() : text(502, 'Couldn’t reach your list. Try again in a minute.');
  }
  const failed = results.length - added.length;
  return text(
    200,
    spokenReply(added, skipped) +
      (failed ? ` ${failed} more didn’t go through; try them again.` : ''),
  );
}
