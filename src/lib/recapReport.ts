import { formatCents } from './money';
import {
  monthKey,
  monthLabel,
  receiptStoreName,
  shiftWeek,
  unitCents,
  weekLabel,
} from './receipts';
import { normalizeName } from './text';
import type { Receipt, ReceiptStore } from '../types';

export type ReportKind = 'week' | 'month';

export interface ReportPeriod {
  kind: ReportKind;
  /** "Week of Nov 2–8" or "October 2026". */
  title: string;
  /** "the week before" or "September". */
  prevName: string;
  start: number;
  end: number;
  prevStart: number;
  /** The month the period ends in ("2026-11"), for the budget and "See receipts". */
  month: string;
}

/** A week, Monday to Sunday, from its Monday. */
export function weekPeriod(start: number): ReportPeriod {
  return {
    kind: 'week',
    title: `Week of ${weekLabel(start)}`,
    prevName: 'the week before',
    start,
    end: shiftWeek(start, 1),
    prevStart: shiftWeek(start, -1),
    month: monthKey(shiftWeek(start, 1) - 1),
  };
}

/** A calendar month, from its key ("2026-10"). */
export function monthPeriod(key: string): ReportPeriod {
  const [y, m] = key.split('-').map(Number);
  const start = new Date(y, m - 1, 1).getTime();
  const prevStart = new Date(y, m - 2, 1).getTime();
  return {
    kind: 'month',
    title: monthLabel(key),
    prevName: new Date(prevStart).toLocaleDateString('en-US', { month: 'long' }),
    start,
    end: new Date(y, m, 1).getTime(),
    prevStart,
    month: key,
  };
}

export interface Slice<K> {
  key: K;
  cents: number;
}

export interface TopItem {
  name: string;
  qty: number;
  cents: number;
}

export interface PriceMove {
  name: string;
  store: ReceiptStore;
  from: number;
  to: number;
  /** 0.2 for up 20%. */
  change: number;
}

export interface PeriodReport {
  period: ReportPeriod;
  cents: number;
  prevCents: number;
  /** Purchases, not shopper tips. */
  trips: number;
  tripsByStore: Slice<ReceiptStore>[];
  tipsCents: number;
  savingsCents: number;
  byStore: Slice<ReceiptStore>[];
  byPerson: Slice<string>[];
  topItems: TopItem[];
  biggest: { store: ReceiptStore; cents: number; at: number } | null;
  priceMoves: PriceMove[];
  /** Spend in `period.month` so far, for budget pace. */
  monthCents: number;
}

const sorted = <K>(m: Map<K, number>): Slice<K>[] =>
  [...m].map(([key, cents]) => ({ key, cents })).sort((a, b) => b.cents - a.cents);
const add = <K>(m: Map<K, number>, k: K, v: number) => m.set(k, (m.get(k) ?? 0) + v);
const lineKey = (l: Receipt['lines'][number]) => l.itemKey || normalizeName(l.name || l.raw);

/** Everything in a week's or month's report: totals, where it went, top items, price moves. */
export function buildReport(receipts: Receipt[], period: ReportPeriod): PeriodReport {
  const inPeriod = (r: Receipt) => r.purchasedAt >= period.start && r.purchasedAt < period.end;
  const byStore = new Map<ReceiptStore, number>();
  const tripsByStore = new Map<ReceiptStore, number>();
  const byPerson = new Map<string, number>();
  const items = new Map<string, TopItem>();
  let cents = 0;
  let prevCents = 0;
  let trips = 0;
  let tipsCents = 0;
  let savingsCents = 0;
  let monthCents = 0;
  let biggest: PeriodReport['biggest'] = null;

  for (const r of receipts) {
    if (monthKey(r.purchasedAt) === period.month) monthCents += r.totalCents;
    if (r.purchasedAt >= period.prevStart && r.purchasedAt < period.start)
      prevCents += r.totalCents;
    if (!inPeriod(r)) continue;
    cents += r.totalCents;
    savingsCents += r.savingsCents;
    add(byStore, r.store, r.totalCents);
    add(byPerson, r.paidBy, r.totalCents);
    if (r.kind === 'tip') {
      tipsCents += r.totalCents;
      continue;
    }
    trips++;
    add(tripsByStore, r.store, 1);
    if (!biggest || r.totalCents > biggest.cents)
      biggest = { store: r.store, cents: r.totalCents, at: r.purchasedAt };
    for (const l of r.lines) {
      if (l.cents <= 0) continue;
      const k = lineKey(l);
      if (!k) continue;
      const it = items.get(k) ?? { name: l.name || l.raw, qty: 0, cents: 0 };
      it.qty += Math.max(1, l.qty);
      it.cents += l.cents;
      items.set(k, it);
    }
  }

  // Price moves: this period's price vs the latest earlier price for the same item and store.
  const earlier = new Map<string, { at: number; unit: number }>();
  for (const r of receipts) {
    if (r.purchasedAt >= period.start) continue;
    for (const l of r.lines) {
      if (l.cents <= 0) continue;
      const k = `${r.store}|${lineKey(l)}`;
      const prev = earlier.get(k);
      if (!prev || r.purchasedAt > prev.at)
        earlier.set(k, { at: r.purchasedAt, unit: unitCents(l) });
    }
  }
  const moves = new Map<string, PriceMove>();
  for (const r of receipts.filter(inPeriod)) {
    for (const l of r.lines) {
      if (l.cents <= 0) continue;
      const k = `${r.store}|${lineKey(l)}`;
      const before = earlier.get(k);
      if (!before) continue;
      const to = unitCents(l);
      const change = (to - before.unit) / before.unit;
      if (Math.abs(change) < 0.05) continue;
      const cur = moves.get(k);
      if (!cur || Math.abs(change) > Math.abs(cur.change))
        moves.set(k, { name: l.name || l.raw, store: r.store, from: before.unit, to, change });
    }
  }

  return {
    period,
    cents,
    prevCents,
    trips,
    tripsByStore: sorted(tripsByStore),
    tipsCents,
    savingsCents,
    byStore: sorted(byStore),
    byPerson: sorted(byPerson),
    topItems: [...items.values()].sort((a, b) => b.cents - a.cents).slice(0, 5),
    biggest,
    priceMoves: [...moves.values()]
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 4),
    monthCents,
  };
}

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
const day = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/** Plain-language takeaways, most useful first. */
export function insights(
  r: PeriodReport,
  opts: { budgetCents: number | null; names: Record<string, string>; now?: number },
): string[] {
  const out: string[] = [];
  const { period } = r;
  const now = opts.now ?? Date.now();

  if (r.prevCents > 0) {
    const diff = r.cents - r.prevCents;
    if (Math.abs(diff) >= 100)
      out.push(
        `You spent ${formatCents(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than ${period.prevName} (${diff > 0 ? 'up' : 'down'} ${pct(diff / r.prevCents)}).`,
      );
    else out.push(`About the same as ${period.prevName}.`);
  } else if (r.cents > 0)
    out.push(
      `Nothing was recorded ${period.kind === 'month' ? 'in ' : ''}${period.prevName} to compare with.`,
    );

  const budget = opts.budgetCents;
  if (budget) {
    if (period.kind === 'month') {
      out.push(
        r.cents > budget
          ? `You went ${formatCents(r.cents - budget)} over your ${formatCents(budget)} budget.`
          : `You stayed ${formatCents(budget - r.cents)} under your ${formatCents(budget)} budget.`,
      );
    } else if (period.month === monthKey(now)) {
      const d = new Date(now);
      const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const pace = Math.round((r.monthCents / d.getDate()) * days);
      const name = monthLabel(period.month).split(' ')[0];
      out.push(
        `At this pace ${name} ends around ${formatCents(pace)}, ${
          pace > budget
            ? `${formatCents(pace - budget)} over`
            : `${formatCents(budget - pace)} under`
        } your ${formatCents(budget)} budget.`,
      );
    } else {
      const name = monthLabel(period.month).split(' ')[0];
      out.push(
        `${name} so far: ${formatCents(r.monthCents)} of your ${formatCents(budget)} budget.`,
      );
    }
  }

  if (r.trips > 0) {
    const where = r.tripsByStore.map((s) => `${s.cents} to ${receiptStoreName(s.key)}`);
    out.push(
      r.trips === 1
        ? `1 trip, to ${receiptStoreName(r.tripsByStore[0].key)}.`
        : `${r.trips} trips: ${where.join(', ')}.`,
    );
  }
  if (r.biggest && r.trips > 1)
    out.push(
      `Biggest trip: ${formatCents(r.biggest.cents)} at ${receiptStoreName(r.biggest.store)} on ${day(r.biggest.at)}.`,
    );
  if (r.topItems[0])
    out.push(
      `Most spent on: ${r.topItems[0].name} (${formatCents(r.topItems[0].cents)}${
        r.topItems[0].qty > 1 ? `, ${r.topItems[0].qty} bought` : ''
      }).`,
    );
  const move = r.priceMoves[0];
  if (move)
    out.push(
      `${move.name} went ${move.change > 0 ? 'up' : 'down'} ${pct(move.change)} at ${receiptStoreName(move.store)} (${formatCents(move.from)} → ${formatCents(move.to)}).`,
    );
  if (r.savingsCents > 0) out.push(`Sales and coupons saved you ${formatCents(r.savingsCents)}.`);
  if (r.tipsCents > 0) out.push(`${formatCents(r.tipsCents)} went to shopper tips.`);
  if (r.byPerson.length > 1 && r.cents > 0)
    out.push(
      r.byPerson
        .map((p) => `${opts.names[p.key] ?? 'A former member'} paid ${pct(p.cents / r.cents)}`)
        .join(', ') + '.',
    );
  return out;
}
