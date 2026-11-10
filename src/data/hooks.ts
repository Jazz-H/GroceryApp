import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type {
  ActivityEvent,
  CatalogEntry,
  Household,
  Item,
  Receipt,
  Settlement,
  Trip,
  UserProfile,
} from '../types';
import {
  toActivity,
  toCatalog,
  toHousehold,
  toItem,
  toReceipt,
  toSettlement,
  toTrip,
} from './convert';

export type Loadable<T> =
  { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; error: Error };

export function useAuthUser(): Loadable<User | null> {
  const [state, setState] = useState<Loadable<User | null>>({ status: 'loading' });
  useEffect(
    () =>
      onAuthStateChanged(
        auth,
        (user) => setState({ status: 'ready', value: user }),
        (error) => setState({ status: 'error', error }),
      ),
    [],
  );
  return state;
}

/** The household id on the user's profile, or null when they haven't joined one yet. */
export function useHouseholdId(uid: string): Loadable<string | null> {
  const [state, setState] = useState<Loadable<string | null>>({ status: 'loading' });
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'users', uid),
        { includeMetadataChanges: true },
        (snap) => {
          // Right after creating or joining, wait until the server has the write. Otherwise the
          // household listener can reach the server first and be denied.
          if (snap.metadata.hasPendingWrites) return;
          const profile = snap.data() as UserProfile | undefined;
          setState({ status: 'ready', value: profile?.householdId ?? null });
        },
        (error) => setState({ status: 'error', error }),
      ),
    [uid],
  );
  return state;
}

export function useHousehold(hid: string): Loadable<Household> {
  const [state, setState] = useState<Loadable<Household>>({ status: 'loading' });
  useEffect(() => {
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let shown = false;
    const listen = () => {
      unsubscribe = onSnapshot(
        doc(db, 'households', hid),
        { includeMetadataChanges: true },
        (snap) => {
          attempt = 0;
          if (snap.exists()) {
            // Right after creating a household, wait until it's saved before showing the app,
            // so the list, feed and trip listeners that start next aren't refused by the rules.
            if (!shown && snap.metadata.hasPendingWrites) return;
            shown = true;
            setState({ status: 'ready', value: toHousehold(snap) });
          }
          // A miss from the offline cache isn't final: wait for the server's answer.
          else if (!snap.metadata.fromCache)
            setState({ status: 'error', error: new Error('Household not found') });
        },
        (error) => {
          // A just-created or just-joined household can briefly be unreadable. Retry a few times.
          if (error.code === 'permission-denied' && attempt < 4) {
            attempt += 1;
            timer = setTimeout(listen, 500 * 2 ** attempt);
          } else setState({ status: 'error', error });
        },
      );
    };
    listen();
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [hid]);
  return state;
}

/** The household's items, or null until the first answer arrives (from the cache or server). */
export function useItems(hid: string): Item[] | null {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'households', hid, 'items'), orderBy('createdAt')),
        // Needed so the server's "still empty" answer arrives even when nothing else changed.
        { includeMetadataChanges: true },
        (snap) => {
          // An empty answer from a cold cache isn't "no items" yet: wait for the server.
          if (snap.empty && snap.metadata.fromCache && navigator.onLine) return;
          setItems(snap.docs.map(toItem));
        },
        () => setItems((current) => current ?? []),
      ),
    [hid],
  );
  return items;
}

export function useActivity(hid: string, max = 150): ActivityEvent[] {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'households', hid, 'activity'), orderBy('at', 'desc'), limit(max)),
        (snap) => setEvents(snap.docs.map(toActivity)),
      ),
    [hid, max],
  );
  return events;
}

export function useActiveTrips(hid: string): Trip[] {
  const [trips, setTrips] = useState<Trip[]>([]);
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'households', hid, 'trips'), where('status', '==', 'active')),
        (snap) => setTrips(snap.docs.map(toTrip)),
      ),
    [hid],
  );
  return trips;
}

export function useReceipts(hid: string, max = 300): Receipt[] {
  return useReceiptsState(hid, max) ?? EMPTY_RECEIPTS;
}

const EMPTY_RECEIPTS: Receipt[] = [];

/** Receipts, or null until the first snapshot has arrived (so "none saved" isn't assumed). */
export function useReceiptsState(hid: string, max = 300): Receipt[] | null {
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  useEffect(
    () =>
      onSnapshot(
        query(
          collection(db, 'households', hid, 'receipts'),
          orderBy('purchasedAt', 'desc'),
          limit(max),
        ),
        (snap) => setReceipts(snap.docs.map(toReceipt)),
      ),
    [hid, max],
  );
  return receipts;
}

/** Settle-up payments between members, newest first. */
export function useSettlements(hid: string): Settlement[] {
  const [list, setList] = useState<Settlement[]>([]);
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'households', hid, 'settlements'), orderBy('at', 'desc'), limit(100)),
        (snap) => setList(snap.docs.map(toSettlement)),
        () => setList([]),
      ),
    [hid],
  );
  return list;
}

/** Everything the household has added before, for "usuals" and restoring prices on re-add. */
export function useCatalog(hid: string): CatalogEntry[] {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  useEffect(
    () =>
      onSnapshot(collection(db, 'households', hid, 'catalog'), (snap) =>
        setEntries(snap.docs.map(toCatalog)),
      ),
    [hid],
  );
  return entries;
}

/** Remembered receipt matches: alias key → item id. */
export function useAliases(hid: string): Map<string, string> {
  const [aliases, setAliases] = useState<Map<string, string>>(() => new Map());
  useEffect(
    () =>
      onSnapshot(collection(db, 'households', hid, 'aliases'), (snap) =>
        setAliases(new Map(snap.docs.map((d) => [d.id, String(d.data().itemId ?? '')]))),
      ),
    [hid],
  );
  return aliases;
}

/** True while the browser reports no network. Writes still work and sync later. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
