import { describe, expect, it } from 'vitest';
import { buildReport, insights, monthPeriod, weekPeriod } from './recapReport';
import { weekStart } from './receipts';
import type { Receipt } from '../types';

const at = (m: number, d: number) => new Date(2026, m - 1, d, 12).getTime();
let n = 0;
const receipt = (
  when: number,
  store: Receipt['store'],
  cents: number,
  paidBy: string,
  lines: [string, number, number?][] = [],
  extra: Partial<Receipt> = {},
): Receipt => ({
  id: String(n++),
  store,
  purchasedAt: when,
  paidBy,
  createdBy: paidBy,
  createdAt: when,
  subtotalCents: cents,
  taxCents: 0,
  savingsCents: 0,
  totalCents: cents,
  lines: lines.map(([name, c, qty = 1]) => ({ raw: name, name, cents: c, qty, itemId: null })),
  ...extra,
});

const receipts = [
  receipt(at(10, 20), 'target', 4000, 'jazz', [['Bananas', 149]]),
  receipt(at(10, 29), 'target', 16665, 'mad'),
  receipt(
    at(11, 2),
    'target',
    12000,
    'jazz',
    [
      ['Bananas', 179],
      ['Chicken breast', 2410, 2],
    ],
    {
      savingsCents: 350,
    },
  ),
  receipt(at(11, 6), 'ht', 4260, 'mad', [['Milk', 459]]),
  receipt(at(11, 6), 'ht', 500, 'mad', [], { kind: 'tip' }),
];

describe('recap report', () => {
  const week = weekPeriod(weekStart(at(11, 4)));

  it('totals the week, its trips, stores, items and price moves', () => {
    const r = buildReport(receipts, week);
    expect(week.title).toBe('Week of Nov 2–8');
    expect(r.cents).toBe(16760);
    expect(r.prevCents).toBe(16665);
    expect(r.trips).toBe(2);
    expect(r.tipsCents).toBe(500);
    expect(r.savingsCents).toBe(350);
    expect(r.byStore.map((s) => s.key)).toEqual(['target', 'ht']);
    expect(r.topItems[0]).toEqual({ name: 'Chicken breast', qty: 2, cents: 2410 });
    expect(r.priceMoves).toEqual([
      { name: 'Bananas', store: 'target', from: 149, to: 179, change: 30 / 149 },
    ]);
    expect(r.biggest).toMatchObject({ store: 'target', cents: 12000 });
  });

  it('writes takeaways, with budget pace in the current month', () => {
    const r = buildReport(receipts, week);
    const notes = insights(r, {
      budgetCents: 60000,
      names: { jazz: 'Jazz', mad: 'Madison' },
      now: at(11, 10),
    });
    expect(notes).toEqual([
      'About the same as the week before.',
      'At this pace November ends around $502.80, $97.20 under your $600.00 budget.',
      '2 trips: 1 to Target, 1 to Harris Teeter.',
      'Biggest trip: $120.00 at Target on Mon, Nov 2.',
      'Most spent on: Chicken breast ($24.10, 2 bought).',
      'Bananas went up 20% at Target ($1.49 → $1.79).',
      'Sales and coupons saved you $3.50.',
      '$5.00 went to shopper tips.',
      'Jazz paid 72%, Madison paid 28%.',
    ]);
  });

  it('compares a month with the one before and the budget', () => {
    const r = buildReport(receipts, monthPeriod('2026-11'));
    expect(r.prevCents).toBe(20665);
    const notes = insights(r, { budgetCents: 15000, names: {}, now: at(12, 1) });
    expect(notes.slice(0, 2)).toEqual([
      'You spent $39.05 less than October (down 19%).',
      'You went $17.60 over your $150.00 budget.',
    ]);
  });
});
