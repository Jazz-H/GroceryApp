import type { Item, Member, Receipt, ReceiptLine, ReceiptStore } from '../types';
import { formatCents } from './money';
import { storeDef } from './stores';
import { normalizeName } from './text';

/** A receipt that hasn't been saved yet: what the review screen edits. */
export type ReceiptDraft = Omit<Receipt, 'id' | 'createdBy' | 'createdAt'>;

/** Sums on a receipt are allowed to be off by this much before we ask for a review. */
export const TOLERANCE_CENTS = 5;

const MAX_LINES = 150;

// ---------- Reading the model's answer ----------

const toCents = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** "2026-10-30" → epoch ms at local noon (noon so time zones never move it to another day). */
export function dateToMs(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1 ? null : d.getTime();
}

export function msToDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Turns the JSON Gemini returns (dollars, loosely typed) into a draft in cents.
 * Anything missing or odd gets a safe default rather than an error; the review screen shows it.
 */
export function fromModel(raw: unknown, paidBy: string, now: number = Date.now()): ReceiptDraft {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const store: ReceiptStore = ['ht', 'target', 'amazon'].includes(String(r.store))
    ? (r.store as ReceiptStore)
    : 'other';
  const rawLines = Array.isArray(r.lines) ? r.lines.slice(0, MAX_LINES) : [];
  const lines: ReceiptLine[] = rawLines
    .map((l) => {
      const o = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
      const rawText = String(o.raw ?? o.name ?? '').slice(0, 120);
      const qty = Math.min(999, Math.max(1, Math.round(Number(o.qty) || 1)));
      return {
        raw: rawText,
        name: String(o.name ?? rawText).slice(0, 120) || rawText,
        qty,
        cents: toCents(o.total),
        itemId: null,
      };
    })
    .filter((l) => l.raw || l.name);
  const purchasedAt = dateToMs(String(r.date ?? '')) ?? new Date(now).setHours(12, 0, 0, 0);
  return {
    store,
    purchasedAt,
    paidBy,
    subtotalCents: toCents(r.subtotal),
    taxCents: toCents(r.tax),
    savingsCents: Math.abs(toCents(r.savings)),
    totalCents: toCents(r.total),
    lines,
  };
}

// ---------- Checking the math ----------

export interface TotalsCheck {
  linesCents: number;
  /** Lines minus the printed subtotal. */
  subtotalGap: number;
  /** Subtotal plus tax minus the printed total. */
  totalGap: number;
  ok: boolean;
}

export function checkTotals(
  d: Pick<ReceiptDraft, 'lines' | 'subtotalCents' | 'taxCents' | 'totalCents'>,
): TotalsCheck {
  const linesCents = d.lines.reduce((s, l) => s + l.cents, 0);
  // Some receipts don't print a subtotal. Then the lines are the subtotal.
  const subtotal = d.subtotalCents || linesCents;
  const subtotalGap = linesCents - subtotal;
  const totalGap = subtotal + d.taxCents - d.totalCents;
  return {
    linesCents,
    subtotalGap,
    totalGap,
    ok:
      d.lines.length > 0 &&
      d.totalCents > 0 &&
      Math.abs(subtotalGap) <= TOLERANCE_CENTS &&
      Math.abs(totalGap) <= TOLERANCE_CENTS,
  };
}

/** Price of one unit on a line, in cents. */
export function unitCents(line: Pick<ReceiptLine, 'cents' | 'qty'>): number {
  return Math.round(line.cents / Math.max(1, line.qty));
}

// ---------- Matching receipt lines to list items ----------

/** Receipt shorthand → the word people type. Kept small: unknown words still prefix-match. */
const ABBREV: Record<string, string> = {
  org: 'organic',
  orgnc: 'organic',
  chkn: 'chicken',
  chk: 'chicken',
  brst: 'breast',
  bnls: 'boneless',
  grnd: 'ground',
  bf: 'beef',
  mlk: 'milk',
  whl: 'whole',
  brd: 'bread',
  ches: 'cheese',
  chs: 'cheese',
  chz: 'cheese',
  yog: 'yogurt',
  ygt: 'yogurt',
  bnna: 'banana',
  bana: 'banana',
  tomatos: 'tomato',
  veg: 'vegetable',
  frz: 'frozen',
  pb: 'peanut',
  tp: 'toilet',
  ppr: 'paper',
  twl: 'towel',
  twls: 'towel',
  oj: 'orange',
  sprd: 'spread',
  crm: 'cream',
  sr: 'sour',
};

/** Store brands and sizes that say nothing about what the item is. */
const NOISE = new Set([
  'ht',
  'hrs',
  'harris',
  'teeter',
  'target',
  'gg',
  'good',
  'gather',
  'mp',
  'market',
  'pantry',
  'kroger',
  'amazon',
  'the',
  'and',
  'of',
  'with',
  'ea',
  'each',
]);

const SIZE = /^\d+(\.\d+)?(oz|z|lb|lbs|ct|pk|pc|g|kg|ml|l|gal|qt|pt|fl)?$/;

function singular(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('oes')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function tokens(text: string): string[] {
  return normalizeName(text)
    .split(' ')
    .filter((w) => w && !NOISE.has(w) && !SIZE.test(w))
    .map((w) => singular(ABBREV[w] ?? w));
}

function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // "spin" → "spinach" yes, but "egg" → "eggplant" no: the cut-off part can't be much longer
  // than what's printed.
  return (
    short.length >= 3 &&
    long.startsWith(short) &&
    long.length - short.length <= Math.max(3, short.length)
  );
}

/** Share of the item's words found on the receipt line, 0 to 1. */
export function matchScore(itemName: string, line: Pick<ReceiptLine, 'raw' | 'name'>): number {
  const want = tokens(itemName);
  if (!want.length) return 0;
  const have = [...new Set([...tokens(line.name), ...tokens(line.raw)])];
  const found = want.filter((w) => have.some((h) => wordsMatch(w, h))).length;
  return found / want.length;
}

export const MATCH_THRESHOLD = 0.66;

/** Key for a remembered match: the same printed text at the same store. */
export function aliasKey(store: ReceiptStore, raw: string): string {
  return `${store}~${normalizeName(raw)}`.slice(0, 200);
}

export interface Match {
  itemId: string;
  /** "remembered" when you confirmed this exact line before. */
  how: 'remembered' | 'guess';
}

/**
 * Best list item for a receipt line. Remembered matches win; otherwise the closest name,
 * preferring open items and items tagged at this store.
 */
export function matchLine(
  line: Pick<ReceiptLine, 'raw' | 'name'>,
  store: ReceiptStore,
  items: Item[],
  aliases: Map<string, string>,
): Match | null {
  const remembered = aliases.get(aliasKey(store, line.raw));
  if (remembered && items.some((i) => i.id === remembered))
    return { itemId: remembered, how: 'remembered' };

  let best: { item: Item; score: number } | null = null;
  for (const item of items) {
    let score = matchScore(item.name, line);
    if (score < MATCH_THRESHOLD) continue;
    if (item.status === 'open') score += 0.02;
    if (store !== 'other' && item.stores.includes(store)) score += 0.01;
    if (!best || score > best.score) best = { item, score };
  }
  return best ? { itemId: best.item.id, how: 'guess' } : null;
}

export function matchAll(
  draft: ReceiptDraft,
  items: Item[],
  aliases: Map<string, string>,
): { draft: ReceiptDraft; remembered: Set<number> } {
  const remembered = new Set<number>();
  const lines = draft.lines.map((line, i) => {
    const m = matchLine(line, draft.store, items, aliases);
    if (m?.how === 'remembered') remembered.add(i);
    return { ...line, itemId: m?.itemId ?? null };
  });
  return { draft: { ...draft, lines }, remembered };
}

// ---------- Spending ----------

export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(key: string, by: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return monthKey(d.getTime());
}

/** "November 2026", or "Nov ’26" for the short style (chart labels). */
export function monthLabel(key: string, style: 'long' | 'short' = 'long'): string {
  const [y, m] = key.split('-').map(Number);
  const name = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: style });
  return style === 'long' ? `${name} ${y}` : `${name} ’${String(y).slice(-2)}`;
}

export interface Slice<K extends string> {
  key: K;
  cents: number;
}

export interface MonthSummary {
  month: string;
  cents: number;
  savingsCents: number;
  count: number;
  byStore: Slice<ReceiptStore>[];
  byPerson: Slice<string>[];
}

function slices<K extends string>(totals: Map<K, number>): Slice<K>[] {
  return [...totals]
    .map(([key, cents]) => ({ key, cents }))
    .filter((s) => s.cents !== 0)
    .sort((a, b) => b.cents - a.cents);
}

export function summarizeMonth(receipts: Receipt[], month: string): MonthSummary {
  const inMonth = receipts.filter((r) => monthKey(r.purchasedAt) === month);
  const byStore = new Map<ReceiptStore, number>();
  const byPerson = new Map<string, number>();
  let cents = 0;
  let savingsCents = 0;
  for (const r of inMonth) {
    cents += r.totalCents;
    savingsCents += r.savingsCents;
    byStore.set(r.store, (byStore.get(r.store) ?? 0) + r.totalCents);
    byPerson.set(r.paidBy, (byPerson.get(r.paidBy) ?? 0) + r.totalCents);
  }
  return {
    month,
    cents,
    savingsCents,
    count: inMonth.length,
    byStore: slices(byStore),
    byPerson: slices(byPerson),
  };
}

/** Totals for the last `n` months, oldest first, ending with `month`. */
export function monthTotals(receipts: Receipt[], month: string, n = 6): Slice<string>[] {
  const out: Slice<string>[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = shiftMonth(month, -i);
    out.push({ key, cents: summarizeMonth(receipts, key).cents });
  }
  return out;
}

export function receiptStoreName(store: ReceiptStore): string {
  return store === 'other' ? 'Other store' : storeDef(store).name;
}

// ---------- Export ----------

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const dollars = (cents: number) => formatCents(cents).replace('$', '');

/** One row per receipt line, ready for a spreadsheet. */
export function toCsv(receipts: Receipt[], members: Record<string, Member>): string {
  const rows: (string | number)[][] = [
    ['Date', 'Store', 'Paid by', 'Item', 'Printed as', 'Qty', 'Line total', 'Receipt total'],
  ];
  const sorted = [...receipts].sort((a, b) => a.purchasedAt - b.purchasedAt);
  for (const r of sorted) {
    const base = [
      msToDate(r.purchasedAt),
      receiptStoreName(r.store),
      members[r.paidBy]?.name ?? '',
    ];
    for (const l of r.lines)
      rows.push([...base, l.name, l.raw, l.qty, dollars(l.cents), dollars(r.totalCents)]);
    if (r.taxCents) rows.push([...base, 'Tax', '', 1, dollars(r.taxCents), dollars(r.totalCents)]);
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

// ---------- Price history ----------

export interface PricePoint {
  store: ReceiptStore;
  /** Price paid for one unit, in cents. */
  unitCents: number;
  at: number;
}

/**
 * What you've paid for an item, newest first, from saved receipts. Matches lines by the item's
 * id, or by its name for receipts saved before the item was cleared and added again.
 */
export function priceHistory(
  receipts: Receipt[],
  item: Pick<Item, 'id' | 'normalizedName'>,
  max = 8,
): PricePoint[] {
  const points: PricePoint[] = [];
  for (const r of receipts)
    for (const l of r.lines) {
      const mine = l.itemId === item.id || (!!l.itemKey && l.itemKey === item.normalizedName);
      if (mine && l.cents > 0)
        points.push({ store: r.store, unitCents: unitCents(l), at: r.purchasedAt });
    }
  return points.sort((a, b) => b.at - a.at).slice(0, max);
}

/** The latest price at each store, cheapest first. */
export function latestByStore(points: PricePoint[]): PricePoint[] {
  const latest = new Map<ReceiptStore, PricePoint>();
  for (const p of [...points].sort((a, b) => b.at - a.at))
    if (!latest.has(p.store)) latest.set(p.store, p);
  return [...latest.values()].sort((a, b) => a.unitCents - b.unitCents);
}
