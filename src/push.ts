import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { isIOS, isStandalone } from './auth';
import { auth, db } from './firebase';

/** Switches a phone can turn off. Keep in sync with PREFS in worker/src/messages.ts. */
export type PushKind = 'adds' | 'trip' | 'receipts' | 'budget' | 'weekly' | 'recap';
export type PushPrefs = Record<PushKind, boolean>;
export const DEFAULT_PREFS: PushPrefs = {
  adds: true,
  trip: true,
  receipts: true,
  budget: true,
  weekly: true,
  recap: true,
};

/** What can be sent. The relay writes the text; see worker/src/messages.ts. */
export type NotifyKind =
  | 'adds'
  | 'trip_start'
  | 'trip_join'
  | 'trip_end'
  | 'receipt'
  | 'budget'
  | 'week_recap'
  | 'recap'
  | 'test';

/** Quiet hours in this phone's time zone, e.g. 22 → 7. */
export interface QuietHours {
  start: number;
  end: number;
  tz: string;
}

/** Everything about this phone's notifications. */
export interface PhoneSettings {
  prefs: PushPrefs;
  /** Epoch ms; nothing arrives before then. 0 when not snoozed. */
  mutedUntil: number;
  quiet: QuietHours | null;
}

const env = import.meta.env;
const RELAY_URL = (env.VITE_PUSH_URL ?? '').replace(/\/$/, '');

/** The relay's base URL, or '' when the app was built without one. */
export function relayUrl(): string {
  return RELAY_URL;
}
const VAPID_PUBLIC_KEY = env.VITE_VAPID_PUBLIC_KEY ?? '';

export type PushSupport =
  | 'ready' // can be turned on
  | 'not-configured' // relay URL or key missing from .env.local
  | 'needs-install' // iPhone: only works from the Home Screen app
  | 'unsupported' // this browser has no Web Push
  | 'denied'; // the person blocked notifications

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
  if (isIOS()) return 'iPad';
  if (/android/i.test(ua)) return 'Android phone';
  if (/mac/i.test(ua)) return 'Mac';
  if (/windows/i.test(ua)) return 'Windows PC';
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
  return (await loadPhone(hid))?.prefs ?? null;
}

/** This phone's saved settings, or null when it isn't subscribed. */
export async function loadPhone(hid: string): Promise<PhoneSettings | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const snap = await getDoc(subRef(hid, await subId(sub.endpoint)));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    prefs: { ...DEFAULT_PREFS, ...(d.prefs as Partial<PushPrefs>) },
    mutedUntil: typeof d.mutedUntil === 'number' ? d.mutedUntil : 0,
    quiet:
      d.quiet && typeof d.quiet.start === 'number' && typeof d.quiet.end === 'number'
        ? { start: d.quiet.start, end: d.quiet.end, tz: String(d.quiet.tz ?? '') }
        : null,
  };
}

/** The id of this phone's subscription doc, if it has one. */
export async function currentSubId(): Promise<string | null> {
  const sub = await currentSubscription().catch(() => null);
  return sub ? subId(sub.endpoint) : null;
}

async function updateThisPhone(hid: string, patch: Record<string, unknown>): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await updateDoc(subRef(hid, await subId(sub.endpoint)), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

/** Snooze this phone until a time (epoch ms), or pass 0 to unsnooze. */
export function setMutedUntil(hid: string, until: number): Promise<void> {
  return updateThisPhone(hid, { mutedUntil: until > Date.now() ? until : deleteField() });
}

/** Quiet hours in this phone's time zone, or null to turn them off. */
export function setQuietHours(hid: string, hours: { start: number; end: number } | null) {
  return updateThisPhone(hid, {
    quiet: hours
      ? { ...hours, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }
      : deleteField(),
  });
}

export interface PushDevice {
  id: string;
  uid: string;
  device: string;
  updatedAt: number;
}

/** Every phone in the household that gets notifications, newest first. */
export function usePushDevices(hid: string): PushDevice[] {
  const [devices, setDevices] = useState<PushDevice[]>([]);
  useEffect(
    () =>
      onSnapshot(
        collection(db, 'households', hid, 'pushSubs'),
        (snap) =>
          setDevices(
            snap.docs
              .map((d) => {
                const x = d.data();
                return {
                  id: d.id,
                  uid: String(x.uid ?? ''),
                  device: String(x.device ?? 'Phone'),
                  updatedAt:
                    typeof x.updatedAt?.toMillis === 'function' ? x.updatedAt.toMillis() : 0,
                };
              })
              .sort((a, b) => b.updatedAt - a.updatedAt),
          ),
        () => setDevices([]),
      ),
    [hid],
  );
  return devices;
}

/** Stops notifications to a phone (any member may remove a stale one). */
export async function removeDevice(hid: string, id: string): Promise<void> {
  await deleteDoc(subRef(hid, id));
}

export function setPref(hid: string, kind: PushKind, on: boolean): Promise<void> {
  return updateThisPhone(hid, { [`prefs.${kind}`]: on });
}

/**
 * Re-saves this phone's subscription on launch. Push services rotate endpoints now and then,
 * and this keeps Firestore pointing at the current one.
 */
export async function refreshSubscription(hid: string, uid: string): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const phone = await loadPhone(hid);
  await save(hid, uid, sub, phone?.prefs ?? DEFAULT_PREFS);
  // save() replaces the doc; keep snooze and quiet hours.
  if (phone?.quiet) await setQuietHoursExact(hid, phone.quiet);
  if (phone && phone.mutedUntil > Date.now()) await setMutedUntil(hid, phone.mutedUntil);
}

function setQuietHoursExact(hid: string, quiet: QuietHours) {
  return updateThisPhone(hid, { quiet });
}

/** Details the relay turns into text. Only numbers, a store and item names. */
export interface NotifyData {
  items?: string[];
  count?: number;
  store?: string;
  mode?: 'together' | 'solo';
  open?: number;
  checked?: number;
  cents?: number;
  budgetCents?: number;
  pct?: number;
  month?: string;
  receipts?: number;
  topStore?: string;
  topCents?: number;
  week?: string;
  prevCents?: number;
  monthCents?: number;
}

export type NotifyResult = { ok: true; sent: number } | { ok: false; error: string };

/**
 * Asks the relay to notify the other members. Never throws: a missed notification isn't worth
 * an error. The result says what happened, for the test button.
 */
export async function notify(
  hid: string,
  kind: NotifyKind,
  data: NotifyData = {},
): Promise<NotifyResult> {
  if (!RELAY_URL) return { ok: false, error: 'This app was built without a notification relay.' };
  if (!auth.currentUser) return { ok: false, error: 'Sign in first.' };
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${RELAY_URL}/notify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ householdId: hid, kind, data }),
      keepalive: true,
    });
    const body = (await res.json().catch(() => ({}))) as { sent?: number; error?: string };
    return res.ok
      ? { ok: true, sent: body.sent ?? 0 }
      : { ok: false, error: body.error ?? `The relay answered ${res.status}.` };
  } catch {
    return { ok: false, error: 'Couldn’t reach the notification relay.' };
  }
}
