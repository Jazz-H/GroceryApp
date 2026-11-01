import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { isStandalone } from './auth';
import { auth, db } from './firebase';

/** Notification kinds a phone can opt out of. Keep in sync with worker/src/index.ts. */
export type PushKind = 'adds' | 'trip';
export type PushPrefs = Record<PushKind, boolean>;
export const DEFAULT_PREFS: PushPrefs = { adds: true, trip: true };

const env = import.meta.env;
const RELAY_URL = (env.VITE_PUSH_URL ?? '').replace(/\/$/, '');
const VAPID_PUBLIC_KEY = env.VITE_VAPID_PUBLIC_KEY ?? '';

export type PushSupport =
  | 'ready' // can be turned on
  | 'not-configured' // relay URL or key missing from .env.local
  | 'needs-install' // iPhone: only works from the Home Screen app
  | 'unsupported' // this browser has no Web Push
  | 'denied'; // the person blocked notifications

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export function pushSupport(): PushSupport {
  if (!RELAY_URL || !VAPID_PUBLIC_KEY) return 'not-configured';
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ready';
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(
    b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4),
  );
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const subRef = (hid: string, id: string) => doc(db, 'households', hid, 'pushSubs', id);

/** Stable id for a subscription: a hash of its endpoint. */
async function subId(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/android/i.test(ua)) return 'Android';
  return 'Browser';
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ready' || Notification.permission !== 'granted') return null;
  return (await registration()).pushManager.getSubscription();
}

async function save(hid: string, uid: string, sub: PushSubscription, prefs: PushPrefs) {
  const json = sub.toJSON();
  await setDoc(subRef(hid, await subId(sub.endpoint)), {
    uid,
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
    prefs,
    device: deviceLabel(),
    updatedAt: serverTimestamp(),
  });
}

/** Asks for permission (must run from a tap), subscribes this phone, and saves it. */
export async function enablePush(hid: string, uid: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications weren’t allowed.');
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(VAPID_PUBLIC_KEY),
    }));
  await save(hid, uid, sub, DEFAULT_PREFS);
}

export async function disablePush(hid: string): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await deleteDoc(subRef(hid, await subId(sub.endpoint))).catch(() => undefined);
  await sub.unsubscribe();
}

export async function loadPrefs(hid: string): Promise<PushPrefs | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const snap = await getDoc(subRef(hid, await subId(sub.endpoint)));
  return snap.exists() ? { ...DEFAULT_PREFS, ...(snap.data().prefs as Partial<PushPrefs>) } : null;
}

export async function setPref(hid: string, kind: PushKind, on: boolean): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await updateDoc(subRef(hid, await subId(sub.endpoint)), {
    [`prefs.${kind}`]: on,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Re-saves this phone's subscription on launch. Push services rotate endpoints now and then,
 * and this keeps Firestore pointing at the current one.
 */
export async function refreshSubscription(hid: string, uid: string): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const prefs = (await loadPrefs(hid)) ?? DEFAULT_PREFS;
  await save(hid, uid, sub, prefs);
}

export interface NotifyMessage {
  kind: PushKind | 'test';
  title: string;
  body?: string;
  actor?: string;
  items?: string[];
  tag?: string;
  url?: string;
}

/** Asks the relay to notify the other members. Never throws: a missed notification isn't worth an error. */
export async function notify(
  hid: string,
  message: NotifyMessage,
): Promise<{ sent: number } | null> {
  if (!RELAY_URL || !auth.currentUser) return null;
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${RELAY_URL}/notify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ householdId: hid, body: '', ...message }),
      keepalive: true,
    });
    return res.ok ? ((await res.json()) as { sent: number }) : null;
  } catch {
    return null;
  }
}
