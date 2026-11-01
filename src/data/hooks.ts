import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { ActivityEvent, Household, Item, Trip } from '../types';
import { toActivity, toHousehold, toItem, toTrip } from './convert';

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
        (snap) =>
          setState({ status: 'ready', value: (snap.data()?.householdId as string | null) ?? null }),
        (error) => setState({ status: 'error', error }),
      ),
    [uid],
  );
  return state;
}

export function useHousehold(hid: string): Loadable<Household> {
  const [state, setState] = useState<Loadable<Household>>({ status: 'loading' });
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'households', hid),
        (snap) =>
          snap.exists()
            ? setState({ status: 'ready', value: toHousehold(snap) })
            : setState({ status: 'error', error: new Error('Household not found') }),
        (error) => setState({ status: 'error', error }),
      ),
    [hid],
  );
  return state;
}

export function useItems(hid: string): Item[] {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(
    () =>
      onSnapshot(query(collection(db, 'households', hid, 'items'), orderBy('createdAt')), (snap) =>
        setItems(snap.docs.map(toItem)),
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
