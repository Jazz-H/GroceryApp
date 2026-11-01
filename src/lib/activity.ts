import type { ActivityEvent, ActivityType, Member } from '../types';
import { storeDef } from './stores';

/** Adds by the same person within this window share a batch and show as one feed entry. */
export const BATCH_WINDOW_MS = 60_000;

export function createBatcher(now: () => number = Date.now, makeId = randomId) {
  let current = '';
  let last = 0;
  return function nextBatchId(): string {
    const t = now();
    if (!current || t - last > BATCH_WINDOW_MS) current = makeId();
    last = t;
    return current;
  };
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface FeedGroup {
  key: string;
  actorId: string;
  type: ActivityType;
  itemNames: string[];
  store?: ActivityEvent['store'];
  detail?: string;
  at: number;
  count: number;
}

/** Merges events (newest first) that share actor, type and batch into one feed entry. */
export function groupFeed(events: ActivityEvent[]): FeedGroup[] {
  const groups: FeedGroup[] = [];
  for (const e of events) {
    const prev = groups[groups.length - 1];
    if (
      prev &&
      prev.actorId === e.actorId &&
      prev.type === e.type &&
      prev.key.startsWith(`${e.batchId}:`) &&
      (e.type === 'add' || e.type === 'check' || e.type === 'delete')
    ) {
      prev.itemNames.push(...e.itemNames);
      prev.count += e.itemNames.length;
      continue;
    }
    groups.push({
      key: `${e.batchId}:${e.id}`,
      actorId: e.actorId,
      type: e.type,
      itemNames: [...e.itemNames],
      store: e.store,
      detail: e.detail,
      at: e.at,
      count: e.itemNames.length,
    });
  }
  return groups;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** One-line summary, e.g. "Sam added 4 items" or "Alex started a solo trip to Target". */
export function describe(group: FeedGroup, member: Member | undefined): string {
  const who = member?.name ?? 'Someone';
  const one = group.itemNames[0] ?? 'an item';
  const what = group.count > 1 ? plural(group.count, 'item') : one;
  const store = group.store ? storeDef(group.store).name : '';
  switch (group.type) {
    case 'add':
      return `${who} added ${what}`;
    case 'check':
      return `${who} checked off ${what}`;
    case 'uncheck':
      return `${who} unchecked ${one}`;
    case 'delete':
      return `${who} removed ${what}`;
    case 'move':
      return `${who} moved ${one} to ${group.detail === 'nice' ? 'Nice-to-have' : 'Grocery'}`;
    case 'edit':
      return `${who} edited ${one}${group.detail ? ` (${group.detail})` : ''}`;
    case 'trip_start':
      return group.detail === 'together'
        ? `${who} started shopping together at ${store}`
        : `${who} started a solo trip to ${store}`;
    case 'trip_join':
      return `${who} joined the trip to ${store}`;
    case 'trip_end':
      return `${who} finished at ${store}`;
    case 'order':
      return `${who} placed a ${store || 'pickup'} order (${plural(group.count, 'item')})`;
    case 'pickup':
      return `${who} picked up the ${store || 'pickup'} order`;
    case 'receipt': {
      const where = store ? ` from ${store}` : '';
      const total = group.detail ? `${group.detail} ` : '';
      const matched = group.count ? ` · ${plural(group.count, 'item')} priced` : '';
      return `${who} added a ${total}receipt${where}${matched}`;
    }
  }
}

export function timeAgo(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
