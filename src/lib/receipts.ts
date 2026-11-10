import type { Item, Member, Receipt, ReceiptLine, ReceiptPayment, ReceiptStore } from '../types';
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
  const payments: ReceiptPayment[] = (Array.isArray(r.payments) ? r.payments.slice(0, 8) : [])
    .map((p) => {
      const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
      return {
        card: String(o.card ?? '').slice(0, 60),
        last4: String(o.last4 ?? '')
          .replace(/\D/g, '')
          .slice(-4),
        cents: toCents(o.amount),
      };
    })
    .filter((p) => p.card || p.last4);
  return {
    ...(r.kind === 'tip' ? { kind: 'tip' as const } : {}),
    ...(payments.length ? { payments } : {}),
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
  /** Keyed by last 4 digits; "" collects coupons, gift cards without digits and unknown. */
  byCard: Slice<string>[];
  /** Card names by last 4, for labels. */
  cardNames: Record<string, string>;
  tipsCents: number;
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
  const byCard = new Map<string, number>();
  const cardNames: Record<string, string> = {};
  let cents = 0;
  let savingsCents = 0;
  let tipsCents = 0;
  for (const r of inMonth) {
    cents += r.totalCents;
    if (r.kind === 'tip') tipsCents += r.totalCents;
    let paid = 0;
    for (const p of r.payments ?? []) {
      byCard.set(p.last4, (byCard.get(p.last4) ?? 0) + p.cents);
      if (p.last4) cardNames[p.last4] ??= p.card;
      paid += p.cents;
    }
    // Whatever the payments don't cover counts as unknown.
    if (r.totalCents - paid > 0) byCard.set('', (byCard.get('') ?? 0) + r.totalCents - paid);
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
    byCard: slices(byCard),
    cardNames,
    tipsCents,
  };
}

/** "•8759" or "•8759 + •3979" for a receipt's cards; "" when none are known. */
export function cardsLabel(r: Pick<Receipt, 'payments'>): string {
  return [...new Set((r.payments ?? []).filter((p) => p.last4).map((p) => `•${p.last4}`))].join(
    ' + ',
  );
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
    [
      'Date',
      'Store',
      'Paid by',
      'Cards',
      'Item',
      'Printed as',
      'Qty',
      'Line total',
      'Receipt total',
    ],
  ];
  const sorted = [...receipts].sort((a, b) => a.purchasedAt - b.purchasedAt);
  for (const r of sorted) {
    const base = [
      msToDate(r.purchasedAt),
      receiptStoreName(r.store),
      members[r.paidBy]?.name ?? '',
      (r.payments ?? [])
        .map((p) => `${p.card}${p.last4 ? ` *${p.last4}` : ''} ${dollars(p.cents)}`)
        .join('; '),
    ];
    // Receipts imported as totals only still get a row.
    if (!r.lines.length)
      rows.push([
        ...base,
        r.kind === 'tip' ? 'Shopper tip' : '(total only)',
        '',
        1,
        dollars(r.totalCents),
        dollars(r.totalCents),
      ]);
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

// ---------- Cards ----------

export interface KnownCard {
  last4: string;
  card: string;
  /** Who usually pays with it: the member most often recorded as paying when it was used. */
  owner: string | null;
  count: number;
}

/** Every card seen on a receipt, most used first, with its likely owner. */
export function knownCards(receipts: Receipt[]): KnownCard[] {
  const byLast4 = new Map<string, { card: string; count: number; payers: Map<string, number> }>();
  for (const r of receipts)
    for (const p of r.payments ?? []) {
      if (!/^\d{4}$/.test(p.last4)) continue;
      const k = byLast4.get(p.last4) ?? { card: p.card, count: 0, payers: new Map() };
      k.count += 1;
      // Only count the payer when this card paid most of the receipt.
      if (p.cents * 2 >= r.totalCents) k.payers.set(r.paidBy, (k.payers.get(r.paidBy) ?? 0) + 1);
      byLast4.set(p.last4, k);
    }
  return [...byLast4]
    .map(([last4, k]) => ({
      last4,
      card: k.card,
      count: k.count,
      owner: [...k.payers].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }))
    .sort((a, b) => b.count - a.count);
}

/** One payment covering the whole total, or none for "unknown". */
export function singlePayment(
  card: Pick<KnownCard, 'card' | 'last4'> | null,
  totalCents: number,
): ReceiptPayment[] | undefined {
  return card ? [{ card: card.card, last4: card.last4, cents: totalCents }] : undefined;
}

/** "Target Circle Credit Card" → "Circle", "Target Mastercard" → "Mastercard": short enough for a bar label. */
export function shortCardName(name: string | undefined): string {
  const short = (name ?? '')
    .replace(/^Target\s+/i, '')
    .replace(/\s+((credit|debit)\s+)?card$/i, '')
    .trim();
  return short || 'Card';
}

/**
 * The budget line a new receipt crossed this month: 100 when spending went over budget, 80 when
 * it passed 80%, or null. Only the highest line crossed is reported, and only once.
 */
export function budgetCrossed(
  beforeCents: number,
  afterCents: number,
  budgetCents: number | null | undefined,
): 80 | 100 | null {
  if (!budgetCents || budgetCents <= 0 || afterCents <= beforeCents) return null;
  for (const pct of [100, 80] as const) {
    const line = (budgetCents * pct) / 100;
    if (beforeCents < line && afterCents >= line) return pct;
  }
  return null;
}

export interface PriceTrend {
  store: ReceiptStore;
  /** Change from the first to the latest price, e.g. 0.18 for +18%. */
  change: number;
  since: number;
  firstCents: number;
  latestCents: number;
}

/**
 * How each store's price moved over the history, for stores with at least two prices at
 * least two weeks apart. Biggest change first.
 */
export function priceTrends(points: PricePoint[]): PriceTrend[] {
  const byStore = new Map<ReceiptStore, PricePoint[]>();
  for (const p of points) byStore.set(p.store, [...(byStore.get(p.store) ?? []), p]);
  const out: PriceTrend[] = [];
  for (const [store, list] of byStore) {
    const sorted = [...list].sort((a, b) => a.at - b.at);
    const first = sorted[0];
    const latest = sorted[sorted.length - 1];
    if (sorted.length < 2 || latest.at - first.at < 14 * 86_400_000 || first.unitCents <= 0)
      continue;
    out.push({
      store,
      change: (latest.unitCents - first.unitCents) / first.unitCents,
      since: first.at,
      firstCents: first.unitCents,
      latestCents: latest.unitCents,
    });
  }
  return out.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

export interface MonthRecap {
  month: string;
  cents: number;
  /** Purchases, not counting shopper tips. */
  receipts: number;
  topStore: ReceiptStore | null;
  topCents: number;
}

/** A month in one line: total, how many receipts, and where most of it went. */
export function monthRecap(receipts: Receipt[], month: string): MonthRecap {
  const s = summarizeMonth(receipts, month);
  const purchases = receipts.filter(
    (r) => monthKey(r.purchasedAt) === month && r.kind !== 'tip',
  ).length;
  return {
    month,
    cents: s.cents,
    receipts: purchases,
    topStore: s.byStore[0]?.key ?? null,
    topCents: s.byStore[0]?.cents ?? 0,
  };
}
