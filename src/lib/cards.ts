import type { BoardRow } from './aisles';
import { NOT_PLACED, ORDERED } from './aisles';
import type { StoreId } from '../types';

type ItemRow = Extract<BoardRow, { type: 'item' }>;

export type BoardBlock =
  | { kind: 'store'; key: string; store: StoreId; label: string }
  | { kind: 'card'; key: string; title: string | null; ordered: boolean; rows: ItemRow[] };

/**
 * Turns the board's flat rows into rounded cards: each aisle heading starts a card, a store
 * heading sits between cards, and items with no heading above them share one untitled card.
 */
export function groupIntoCards(rows: BoardRow[]): BoardBlock[] {
  const blocks: BoardBlock[] = [];
  let card: Extract<BoardBlock, { kind: 'card' }> | null = null;
  rows.forEach((row, i) => {
    if (row.type === 'store') {
      blocks.push({ kind: 'store', key: `s-${row.store}`, store: row.store, label: row.label });
      card = null;
    } else if (row.type === 'aisle') {
      card = {
        kind: 'card',
        key: `a-${i}-${row.label}`,
        title: row.label,
        ordered: row.label === ORDERED,
        rows: [],
      };
      blocks.push(card);
    } else {
      if (!card) {
        card = { kind: 'card', key: `c-${i}`, title: null, ordered: false, rows: [] };
        blocks.push(card);
      }
      card.rows.push(row);
    }
  });
  return blocks.filter((b) => b.kind === 'store' || b.rows.length > 0);
}

export interface CardLook {
  /** SVG path data for a 24×24 stroke icon. */
  icon: string;
  /** Tile background and icon color. */
  tint: string;
  ink: string;
}

const ICONS = {
  produce:
    'M12 21c-4.5 0-8-3.4-8-8 0-3.6 2.5-6 5-6 1.3 0 2.2.5 3 1 .8-.5 1.7-1 3-1 2.5 0 5 2.4 5 6 0 4.6-3.5 8-8 8zM12 7c0-2 1-4 3-4',
  dairy: 'M8 2h8M9 2v3l-3 4v13h12V9l-3-4V2M6 13h12',
  frozen: 'M12 2v20M4.9 7l14.2 10M19.1 7L4.9 17M9 4l3 3 3-3M9 20l3-3 3 3',
  bakery: 'M4 11a8 5 0 0 1 16 0v8H4zM8 11v8M12 11v8M16 11v8',
  meat: 'M3 12c3-5 9-7 14-4l4-3v14l-4-3c-5 3-11 1-14-4zM15 11h.01',
  deli: 'M3 9l9-5 9 5M5 9v10h14V9M9 19v-5h6v5',
  pickup: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  aisle: 'M4 4v16M20 4v16M4 9h16M4 15h16',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
};

const LOOKS: { test: RegExp; look: CardLook }[] = [
  {
    test: /produce|fruit|veg|salad/i,
    look: { icon: ICONS.produce, tint: 'rgba(111,211,155,0.14)', ink: '#6fd39b' },
  },
  {
    test: /dairy|egg|milk|cheese|yogurt/i,
    look: { icon: ICONS.dairy, tint: 'rgba(157,187,255,0.14)', ink: '#9dbbff' },
  },
  {
    test: /frozen|freezer|ice/i,
    look: { icon: ICONS.frozen, tint: 'rgba(196,170,255,0.14)', ink: '#c4aaff' },
  },
  {
    test: /bakery|bread/i,
    look: { icon: ICONS.bakery, tint: 'rgba(240,180,100,0.14)', ink: '#f0b464' },
  },
  {
    test: /meat|seafood|fish|butcher/i,
    look: { icon: ICONS.meat, tint: 'rgba(255,138,128,0.14)', ink: '#ff8a80' },
  },
  { test: /deli/i, look: { icon: ICONS.deli, tint: 'rgba(240,180,100,0.14)', ink: '#f0b464' } },
  { test: /aisle/i, look: { icon: ICONS.aisle, tint: 'rgba(142,154,166,0.16)', ink: '#c8d0d8' } },
];

/** Icon and tint for a card heading such as "Produce", "Aisle 7" or "Ordered for pickup". */
export function cardLook(title: string | null): CardLook {
  if (title === ORDERED)
    return { icon: ICONS.pickup, tint: 'rgba(240,180,100,0.14)', ink: '#f0b464' };
  if (!title || title === NOT_PLACED)
    return { icon: ICONS.tag, tint: 'rgba(142,154,166,0.16)', ink: '#c8d0d8' };
  return (
    LOOKS.find((l) => l.test.test(title))?.look ?? {
      icon: ICONS.tag,
      tint: 'rgba(142,154,166,0.16)',
      ink: '#c8d0d8',
    }
  );
}

/** "Madison added 4 things today" — counts the other members' adds since midnight. */
export function partnerAddsToday(
  events: { actorId: string; type: string; itemNames: string[]; at: number }[],
  uid: string,
  now: number = Date.now(),
): Map<string, number> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'add' || e.actorId === uid || e.at < start.getTime()) continue;
    counts.set(e.actorId, (counts.get(e.actorId) ?? 0) + Math.max(1, e.itemNames.length));
  }
  return counts;
}
