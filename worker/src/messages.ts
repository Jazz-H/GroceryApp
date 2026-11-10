/**
 * Notification text is written here, on the relay, from a fixed set of kinds and a few
 * numbers and names. Phones can't push arbitrary text to each other.
 */

export const KINDS = [
  'adds',
  'trip_start',
  'trip_join',
  'trip_end',
  'receipt',
  'budget',
  'test',
] as const;
export type Kind = (typeof KINDS)[number];

/** The per-phone switch that controls each kind. Keep in sync with src/push.ts. */
export const PREF_FOR: Record<Exclude<Kind, 'test'>, Pref> = {
  adds: 'adds',
  trip_start: 'trip',
  trip_join: 'trip',
  trip_end: 'trip',
  receipt: 'receipts',
  budget: 'budget',
};
export const PREFS = ['adds', 'trip', 'receipts', 'budget'] as const;
export type Pref = (typeof PREFS)[number];

const STORES: Record<string, string> = { ht: 'Harris Teeter', target: 'Target', amazon: 'Amazon' };

export interface NotifyData {
  items?: string[];
  /** How many items were added (items may be a shortened list). */
  count?: number;
  store?: string;
  mode?: 'together' | 'solo';
  /** Open items on the list when a trip starts. */
  open?: number;
  /** Items checked off when a trip ends. */
  checked?: number;
  /** Receipt total, or month spend for budget. */
  cents?: number;
  budgetCents?: number;
  /** Budget threshold crossed, e.g. 80 or 100. */
  pct?: number;
  /** "November", for budget messages. */
  month?: string;
}

export interface Message {
  title: string;
  body: string;
  tag: string;
  url: string;
  items?: string[];
  count?: number;
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const storeName = (s: string | undefined) => (s && STORES[s]) || 'the store';

/** Cleans the client's numbers and names; anything unexpected is dropped. */
export function cleanData(input: unknown): NotifyData {
  const r = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const int = (v: unknown, max: number) =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.max(0, Math.min(max, Math.round(v)))
      : undefined;
  const items = Array.isArray(r.items)
    ? r.items
        .filter((i): i is string => typeof i === 'string' && i.trim() !== '')
        .slice(0, 20)
        .map((i) => i.slice(0, 60))
    : undefined;
  return {
    items,
    count: int(r.count, 10_000),
    store: typeof r.store === 'string' && r.store in STORES ? r.store : undefined,
    mode: r.mode === 'together' || r.mode === 'solo' ? r.mode : undefined,
    open: int(r.open, 10_000),
    checked: int(r.checked, 10_000),
    cents: int(r.cents, 100_000_00),
    budgetCents: int(r.budgetCents, 100_000_00),
    pct: int(r.pct, 1000),
    month:
      typeof r.month === 'string' ? r.month.replace(/[^\p{L}\d ]/gu, '').slice(0, 20) : undefined,
  };
}

export function compose(kind: Kind, d: NotifyData, actor: string, senderUid: string): Message {
  switch (kind) {
    case 'adds': {
      const items = d.items ?? [];
      const count = Math.max(d.count ?? 0, items.length, 1);
      return {
        title:
          count > 1 ? `${actor} added ${count} items` : `${actor} added ${items[0] ?? 'an item'}`,
        body: items.join(', ') + (count > items.length && items.length ? ', …' : ''),
        tag: `adds-${senderUid}`,
        url: '/#list',
        items,
        count,
      };
    }
    case 'trip_start': {
      const open = d.open ?? 0;
      return {
        title: `${actor} is at ${storeName(d.store)}`,
        body:
          d.mode === 'together'
            ? `Shopping together. ${plural(open, 'item')} on the list.`
            : `Shopping solo with ${plural(open, 'item')}. Add anything you need now.`,
        tag: `trip-${d.store ?? 'store'}`,
        url: d.store ? `/#list/${d.store}` : '/#list',
      };
    }
    case 'trip_join':
      return {
        title: `${actor} joined your ${storeName(d.store)} trip`,
        body: 'You’re shopping together now.',
        tag: `trip-${d.store ?? 'store'}`,
        url: d.store ? `/#list/${d.store}` : '/#list',
      };
    case 'trip_end':
      return {
        title: `${actor} finished at ${storeName(d.store)}`,
        body:
          d.checked !== undefined
            ? `${plural(d.checked, 'item')} checked off.`
            : 'The trip is over.',
        tag: `trip-${d.store ?? 'store'}`,
        url: '/#list',
      };
    case 'receipt':
      return {
        title: `${actor} saved a ${storeName(d.store)} receipt`,
        body: d.cents !== undefined ? `${money(d.cents)} added to spending.` : 'Added to spending.',
        tag: 'receipt',
        url: '/#spend',
      };
    case 'budget': {
      const month = d.month || 'This month';
      const over = (d.pct ?? 0) >= 100;
      return {
        title: over
          ? `${month} is over budget`
          : `${month} spending passed ${d.pct ?? 80}% of budget`,
        body:
          d.cents !== undefined && d.budgetCents
            ? `${money(d.cents)} of ${money(d.budgetCents)} spent.`
            : '',
        tag: 'budget',
        url: '/#spend',
      };
    }
    case 'test':
      return {
        title: 'Stocked notifications work',
        body: 'You’ll hear about your partner’s trips, adds and receipts here.',
        tag: 'test',
        url: '/',
      };
  }
}
