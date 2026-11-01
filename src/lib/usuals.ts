import type { ActivityEvent, CatalogEntry, Item, StoreId } from '../types';
import { normalizeName } from './text';

const DAY = 86_400_000;

/** How many add times a catalog entry keeps. */
export const KEEP_ADDS = 6;

export interface Usual {
  key: string;
  name: string;
  /** Store to add it at: where it was bought most recently. */
  store: StoreId;
  /** Days since it was last added, rounded. */
  daysSince: number;
}

/** Catalog key for an item name: its normalized form, safe as a Firestore document id. */
export function catalogKey(name: string): string {
  return normalizeName(name).slice(0, 150);
}

/** The add times to store after adding once more at `now`. */
export function nextAddedAt(prev: number[] | undefined, now: number): number[] {
  return [...(prev ?? []), now].sort((a, b) => a - b).slice(-KEEP_ADDS);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

interface History {
  key: string;
  name: string;
  count: number;
  addedAt: number[];
  store: StoreId;
}

/**
 * Merges the catalog with recent "add" events from the activity log. The log covers households
 * (and items) from before the catalog existed; the catalog wins when both know an item.
 */
function histories(catalog: CatalogEntry[], activity: ActivityEvent[]): History[] {
  const byKey = new Map<string, History>();
  for (const c of catalog) {
    if (!c.key || !c.name) continue;
    byKey.set(c.key, {
      key: c.key,
      name: c.name,
      count: c.count,
      addedAt: [...c.addedAt].sort((a, b) => a - b),
      store: c.stores[0] ?? 'ht',
    });
  }
  const fromLog = new Map<string, History>();
  for (const e of activity) {
    if (e.type !== 'add') continue;
    e.itemNames.forEach((name) => {
      const key = catalogKey(name);
      if (!key || byKey.has(key)) return;
      const h = fromLog.get(key) ?? { key, name, count: 0, addedAt: [], store: e.store ?? 'ht' };
      h.count += 1;
      h.addedAt.push(e.at);
      fromLog.set(key, h);
    });
  }
  for (const h of fromLog.values()) {
    h.addedAt.sort((a, b) => a - b);
    byKey.set(h.key, h);
  }
  return [...byKey.values()];
}

/**
 * Things you buy regularly that aren't on the list right now, most "due" first.
 *
 * - Bought 2+ times: due when the time since the last add reaches ~60% of the usual gap
 *   between adds (so weekly milk shows up after about 4 days).
 * - Bought once: only after 5+ days, ranked below the regulars.
 */
export function suggestUsuals(
  catalog: CatalogEntry[],
  activity: ActivityEvent[],
  onList: Item[],
  now: number = Date.now(),
  max = 8,
): Usual[] {
  const listed = new Set(onList.map((i) => i.normalizedName || catalogKey(i.name)));
  const scored: (Usual & { score: number })[] = [];
  for (const h of histories(catalog, activity)) {
    if (listed.has(h.key) || !h.addedAt.length) continue;
    const last = h.addedAt[h.addedAt.length - 1];
    const since = now - last;
    if (since < DAY / 2) continue;
    let score: number;
    if (h.addedAt.length >= 2 && h.count >= 2) {
      const gaps = h.addedAt.slice(1).map((t, i) => t - h.addedAt[i]);
      const interval = Math.max(DAY, median(gaps));
      const due = since / interval;
      if (due < 0.6) continue;
      score = Math.min(due, 3) + Math.log2(h.count) * 0.3;
    } else {
      if (since < 5 * DAY) continue;
      score = 0.3;
    }
    scored.push({
      key: h.key,
      name: h.name,
      store: h.store,
      daysSince: Math.round(since / DAY),
      score,
    });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, max)
    .map(({ score: _score, ...u }) => u);
}
