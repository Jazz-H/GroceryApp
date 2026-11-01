// Generates a VAPID key pair for Web Push. Run with: npm run vapid
import { webcrypto as crypto } from 'node:crypto';

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
]);
const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
const { d } = await crypto.subtle.exportKey('jwk', keys.privateKey);

console.log(`
Public key (put in .env.local as VITE_VAPID_PUBLIC_KEY and in worker/wrangler.toml as VAPID_PUBLIC_KEY):
${publicKey}

Private key (keep secret: cd worker && npx wrangler@4 secret put VAPID_PRIVATE_KEY, then paste):
${d}
`);
