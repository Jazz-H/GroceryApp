// Writes .env.production.local for CI builds.
// The Firebase web config is public (it ships inside the app), so CI reads it from the
// project's own Hosting endpoint unless repository variables already provide it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const project = process.env.FIREBASE_PROJECT_ID || 'fridgeboard-642b9';
let cfg = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  appId: process.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

if (!cfg.apiKey || !cfg.appId) {
  const url = `https://${project}.web.app/__/firebase/init.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't read Firebase config from ${url} (${res.status}).`);
  const live = await res.json();
  cfg = { apiKey: live.apiKey, appId: live.appId, messagingSenderId: live.messagingSenderId };
}
if (!cfg.apiKey || !cfg.appId) throw new Error('Firebase web config is incomplete.');

const lines = [
  `VITE_FIREBASE_API_KEY=${cfg.apiKey}`,
  // Sign-in runs on the app's own domain (needed for iPhone home-screen apps).
  `VITE_FIREBASE_AUTH_DOMAIN=${project}.web.app`,
  `VITE_FIREBASE_PROJECT_ID=${project}`,
  `VITE_FIREBASE_APP_ID=${cfg.appId}`,
  `VITE_FIREBASE_MESSAGING_SENDER_ID=${cfg.messagingSenderId ?? ''}`,
  'VITE_USE_EMULATORS=false',
];
// Notifications: repository variables win; otherwise the public values committed in
// push-config.json (written after the "Set up notifications" workflow).
let push = {};
if (existsSync('push-config.json')) push = JSON.parse(readFileSync('push-config.json', 'utf8'));
const vapidKey = process.env.VITE_VAPID_PUBLIC_KEY || push.publicKey;
const pushUrl = process.env.VITE_PUSH_URL || push.url;
if (vapidKey) lines.push(`VITE_VAPID_PUBLIC_KEY=${vapidKey}`);
if (pushUrl) lines.push(`VITE_PUSH_URL=${pushUrl}`);
writeFileSync('.env.production.local', lines.join('\n') + '\n');
console.log(`Wrote .env.production.local for ${project}`);
