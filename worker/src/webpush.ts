/**
 * Minimal Web Push sender using only WebCrypto, so it runs in Cloudflare Workers and Node 20+.
 *
 * - Payload encryption: RFC 8291 (Message Encryption for Web Push) with RFC 8188 aes128gcm.
 * - Sender identity: RFC 8292 (VAPID), an ES256 JWT in the Authorization header.
 */

const enc = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;

export function b64urlToBytes(s: string): Bytes {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

export interface EncryptOptions {
  /** Fixed salt and sender keys, for tests only. */
  salt?: Bytes;
  senderKeys?: CryptoKeyPair;
}

/** Encrypts a push payload for one subscription (its p256dh and auth keys, base64url). */
export async function encryptPayload(
  payload: Uint8Array,
  p256dh: string,
  auth: string,
  opts: EncryptOptions = {},
): Promise<Bytes> {
  const uaPublic = b64urlToBytes(p256dh);
  const authSecret = b64urlToBytes(auth);
  if (uaPublic.length !== 65) throw new Error('Subscription p256dh key must be 65 bytes');
  if (authSecret.length !== 16) throw new Error('Subscription auth secret must be 16 bytes');

  const sender =
    opts.senderKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256),
  );

  // RFC 8291 §3.4: combine the ECDH secret with the subscription's auth secret.
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  // RFC 8188: content key and nonce from a random salt.
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record: the payload followed by the 0x02 "last record" delimiter.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      concat(payload, new Uint8Array([2])),
    ),
  );

  // Header: salt (16) | record size (4, big-endian) | key id length (1) | key id (sender public key)
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

/** Imports the VAPID private key (base64url `d`) using the public key for x and y. */
export async function importVapidPrivateKey(publicKey: string, privateKey: string) {
  const pub = b64urlToBytes(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID public key must be 65 bytes');
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToB64url(pub.slice(1, 33)),
      y: bytesToB64url(pub.slice(33, 65)),
      d: privateKey,
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

export interface Vapid {
  publicKey: string;
  privateKey: CryptoKey;
  /** mailto: or https: contact for the push service. */
  subject: string;
}

/** The `Authorization: vapid t=…, k=…` header for an endpoint. */
export async function vapidHeader(
  endpoint: string,
  vapid: Vapid,
  now = Date.now(),
): Promise<string> {
  const json = (o: object) => bytesToB64url(enc.encode(JSON.stringify(o)));
  const claims = {
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: vapid.subject,
  };
  const unsigned = `${json({ typ: 'JWT', alg: 'ES256' })}.${json(claims)}`;
  // WebCrypto returns the raw r||s signature, which is exactly what JWS ES256 wants.
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    vapid.privateKey,
    enc.encode(unsigned),
  );
  return `vapid t=${unsigned}.${bytesToB64url(new Uint8Array(sig))}, k=${vapid.publicKey}`;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends one push. Returns the push service's HTTP status (201 = accepted, 404/410 = gone). */
export async function sendPush(
  target: PushTarget,
  payload: unknown,
  vapid: Vapid,
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  const body = await encryptPayload(
    enc.encode(JSON.stringify(payload)),
    target.p256dh,
    target.auth,
  );
  const res = await fetchFn(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(target.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(24 * 3600),
      Urgency: 'normal',
    },
    body,
  });
  return res.status;
}
