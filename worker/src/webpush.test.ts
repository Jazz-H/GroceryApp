import { createECDH, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: http_ece ships no types. It's an independent RFC 8188/8291 implementation.
import ece from 'http_ece';
import {
  b64urlToBytes,
  bytesToB64url,
  encryptPayload,
  importVapidPrivateKey,
  vapidHeader,
} from './webpush';

/** A fake browser subscription: its ECDH key pair and auth secret. */
function fakeSubscription() {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  return {
    ua,
    auth,
    p256dh: bytesToB64url(ua.getPublicKey()),
    authB64: bytesToB64url(auth),
  };
}

async function vapidKeys() {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = bytesToB64url(
    new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)),
  );
  const { d } = await crypto.subtle.exportKey('jwk', keys.privateKey);
  return { publicKey, privateB64: d!, verifyKey: keys.publicKey };
}

describe('encryptPayload', () => {
  it('produces aes128gcm that an independent implementation decrypts', async () => {
    const sub = fakeSubscription();
    const message = JSON.stringify({ title: 'Sam added 3 items', body: 'Eggs, Milk, Bread' });
    const encrypted = await encryptPayload(
      new TextEncoder().encode(message),
      sub.p256dh,
      sub.authB64,
    );
    const decrypted = ece.decrypt(Buffer.from(encrypted), {
      version: 'aes128gcm',
      privateKey: sub.ua,
      authSecret: sub.auth,
    });
    expect(decrypted.toString('utf8')).toBe(message);
  });

  it('writes the RFC 8188 header', async () => {
    const sub = fakeSubscription();
    const out = await encryptPayload(new Uint8Array([1, 2, 3]), sub.p256dh, sub.authB64);
    const view = new DataView(out.buffer);
    expect(view.getUint32(16)).toBe(4096); // record size
    expect(out[20]).toBe(65); // key id = uncompressed sender public key
    expect(out[21]).toBe(4);
    expect(out.length).toBe(21 + 65 + 3 + 1 + 16); // header + key + payload + delimiter + tag
  });

  it('rejects malformed subscription keys', async () => {
    await expect(
      encryptPayload(new Uint8Array(1), 'AAAA', bytesToB64url(randomBytes(16))),
    ).rejects.toThrow();
  });
});

describe('vapidHeader', () => {
  it('signs an ES256 JWT for the push service origin', async () => {
    const keys = await vapidKeys();
    const privateKey = await importVapidPrivateKey(keys.publicKey, keys.privateB64);
    const header = await vapidHeader(
      'https://fcm.googleapis.com/fcm/send/abc123',
      { publicKey: keys.publicKey, privateKey, subject: 'mailto:us@example.com' },
      1_800_000_000_000,
    );
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(m).not.toBeNull();
    const [, h, c, sig, k] = m!;
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(new TextDecoder().decode(b64urlToBytes(h)))).toEqual({
      typ: 'JWT',
      alg: 'ES256',
    });
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(c)));
    expect(claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 1_800_000_000 + 43_200,
      sub: 'mailto:us@example.com',
    });
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.verifyKey,
      b64urlToBytes(sig),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });
});
