import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase';

/** A saved voice key. Only its hash is stored; the key itself is shown once, when it's made. */
export interface VoiceKey {
  hash: string;
  uid: string;
  label: string;
  createdAt: number;
}

const keys = (hid: string) => collection(db, 'households', hid, 'voiceKeys');

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function secret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(30));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** "iPhone", "Android phone" or "Phone", for naming a key after the device that made it. */
export function deviceLabel(ua = navigator.userAgent): string {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android phone';
  return 'Phone';
}

/**
 * Makes a voice key "<householdId>.<uid>.<secret>" and saves its SHA-256, so the relay can add
 * items for this member while signed out. Returns the key to paste into a Shortcut.
 */
export async function createVoiceKey(hid: string, uid: string, label: string): Promise<string> {
  const key = `${hid}.${uid}.${secret()}`;
  await setDoc(doc(keys(hid), await sha256Hex(key)), {
    uid,
    label: label.slice(0, 40),
    createdAt: Date.now(),
  });
  return key;
}

export async function removeVoiceKey(hid: string, hash: string) {
  await deleteDoc(doc(keys(hid), hash));
}

export function useVoiceKeys(hid: string): VoiceKey[] {
  const [list, setList] = useState<VoiceKey[]>([]);
  useEffect(
    () =>
      onSnapshot(
        keys(hid),
        (snap) =>
          setList(
            snap.docs
              .map((d) => {
                const v = d.data();
                return {
                  hash: d.id,
                  uid: String(v.uid ?? ''),
                  label: String(v.label ?? 'Phone'),
                  createdAt: typeof v.createdAt === 'number' ? v.createdAt : 0,
                };
              })
              .sort((a, b) => b.createdAt - a.createdAt),
          ),
        () => setList([]),
      ),
    [hid],
  );
  return list;
}
