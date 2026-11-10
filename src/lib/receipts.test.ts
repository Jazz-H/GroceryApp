import { describe, expect, it } from 'vitest';
import type { Receipt } from '../types';
import {
  aliasKey,
  checkTotals,
  dateToMs,
  fromModel,
  matchAll,
  matchLine,
  matchScore,
  monthKey,
  latestByStore,
  monthTotals,
  msToDate,
  priceHistory,
  summarizeMonth,
  toCsv,
  unitCents,
  monthLabel,
  monthRecap,
  priceTrends,
  budgetCrossed,
  cardsLabel,
  knownCards,
  shortCardName,
  singlePayment,
} from './receipts';
import { makeItem } from './testItems';

const line = (raw: string, name = raw, cents = 100, qty = 1) => ({
  raw,
  name,
  cents,
  qty,
  itemId: null,
});

describe('fromModel', () => {
  it('converts dollars to cents and fills defaults', () => {
    const d = fromModel(
      {
        store: 'ht',
        date: '2026-10-30',
        lines: [
          { raw: 'HT ORG SPINACH 10Z', name: 'Organic spinach', qty: 1, total: 3.99 },
          { raw: 'BANANAS', qty: 0, total: '1.29' },
          { raw: '', name: '' },
        ],
        subtotal: 5.28,
        tax: 0.11,
        savings: -1.5,
        total: 5.39,
      },
      'alex',
    );
    expect(d.store).toBe('ht');
    expect(msToDate(d.purchasedAt)).toBe('2026-10-30');
    expect(d.lines).toEqual([
      { raw: 'HT ORG SPINACH 10Z', name: 'Organic spinach', qty: 1, cents: 399, itemId: null },
      { raw: 'BANANAS', name: 'BANANAS', qty: 1, cents: 129, itemId: null },
    ]);
    expect(d.savingsCents).toBe(150);
    expect(d.totalCents).toBe(539);
    expect(d.paidBy).toBe('alex');
  });

  it('survives garbage', () => {
    const now = new Date(2026, 9, 31, 8).getTime();
    const d = fromModel('nope', 'sam', now);
    expect(d.store).toBe('other');
    expect(d.lines).toEqual([]);
    expect(msToDate(d.purchasedAt)).toBe('2026-10-31');
  });
});

describe('dateToMs', () => {
  it('rejects impossible dates', () => {
    expect(dateToMs('2026-02-31')).toBeNull();
    expect(dateToMs('Oct 30')).toBeNull();
    expect(dateToMs('2026-02-28')).not.toBeNull();
  });
});

describe('checkTotals', () => {
  const lines = [line('A', 'A', 300), line('B', 'B', 200)];
  it('passes when everything adds up within a few cents', () => {
    expect(checkTotals({ lines, subtotalCents: 500, taxCents: 10, totalCents: 512 }).ok).toBe(true);
  });
  it('flags a missing line', () => {
    const c = checkTotals({ lines, subtotalCents: 700, taxCents: 0, totalCents: 700 });
    expect(c.ok).toBe(false);
    expect(c.subtotalGap).toBe(-200);
  });
  it('uses the lines when no subtotal is printed', () => {
    expect(checkTotals({ lines, subtotalCents: 0, taxCents: 0, totalCents: 500 }).ok).toBe(true);
  });
  it('fails an empty receipt', () => {
    expect(checkTotals({ lines: [], subtotalCents: 0, taxCents: 0, totalCents: 0 }).ok).toBe(false);
  });
});

describe('unitCents', () => {
  it('divides by quantity', () => {
    expect(unitCents({ cents: 598, qty: 2 })).toBe(299);
  });
});

describe('matching', () => {
  it('reads receipt shorthand', () => {
    expect(matchScore('Spinach', line('HT ORG SPINACH 10Z'))).toBe(1);
    expect(matchScore('Chicken breast', line('BNLS CHKN BRST'))).toBe(1);
    expect(matchScore('Bananas', line('BANANA'))).toBe(1);
    expect(matchScore('Paper towels', line('BOUNTY PPR TWL 6PK'))).toBe(1);
  });

  it('does not match unrelated words', () => {
    expect(matchScore('Eggs', line('EGGPLANT'))).toBe(0);
    expect(matchScore('Milk', line('HT BREAD'))).toBe(0);
  });

  const spinach = makeItem('Spinach', ['ht']);
  const oldSpinach = makeItem('Spinach', ['target'], {}, { status: 'checked' });
  const milk = makeItem('Oat milk', ['ht']);

  it('prefers open items tagged at the store', () => {
    expect(matchLine(line('ORG SPINACH'), 'ht', [oldSpinach, spinach], new Map())).toEqual({
      itemId: spinach.id,
      how: 'guess',
    });
  });

  it('uses remembered matches first', () => {
    const aliases = new Map([[aliasKey('ht', 'OATLY BARISTA'), milk.id]]);
    expect(matchLine(line('OATLY BARISTA'), 'ht', [spinach, milk], aliases)).toEqual({
      itemId: milk.id,
      how: 'remembered',
    });
    // Remembered at another store doesn't count.
    expect(matchLine(line('OATLY BARISTA'), 'target', [spinach, milk], aliases)).toBeNull();
  });

  it('ignores a remembered item that was deleted', () => {
    const aliases = new Map([[aliasKey('ht', 'XYZ'), 'gone']]);
    expect(matchLine(line('XYZ'), 'ht', [spinach], aliases)).toBeNull();
  });

  it('matches a whole draft', () => {
    const d = fromModel(
      {
        store: 'ht',
        lines: [
          { raw: 'ORG SPINACH', total: 3 },
          { raw: 'GUM', total: 1 },
        ],
      },
      'u1',
    );
    const { draft } = matchAll(d, [spinach, milk], new Map());
    expect(draft.lines.map((l) => l.itemId)).toEqual([spinach.id, null]);
  });
});

function receipt(store: Receipt['store'], date: string, cents: number, paidBy = 'alex'): Receipt {
  return {
    id: `${store}-${date}-${cents}`,
    store,
    purchasedAt: dateToMs(date)!,
    paidBy,
    createdBy: paidBy,
    createdAt: 0,
    subtotalCents: cents,
    taxCents: 0,
    savingsCents: 50,
    totalCents: cents,
    lines: [line('Milk, 2%', 'Milk "2%"', cents)],
  };
}

describe('spending', () => {
  const receipts = [
    receipt('ht', '2026-10-02', 5000),
    receipt('ht', '2026-10-20', 3000, 'sam'),
    receipt('target', '2026-10-21', 2000),
    receipt('ht', '2026-09-15', 4000),
  ];

  it('summarizes a month by store and person', () => {
    const s = summarizeMonth(receipts, '2026-10');
    expect(s.cents).toBe(10000);
    expect(s.count).toBe(3);
    expect(s.savingsCents).toBe(150);
    expect(s.byStore).toEqual([
      { key: 'ht', cents: 8000 },
      { key: 'target', cents: 2000 },
    ]);
    expect(s.byPerson).toEqual([
      { key: 'alex', cents: 7000 },
      { key: 'sam', cents: 3000 },
    ]);
  });

  it('lists recent months oldest first, across a year boundary', () => {
    const t = monthTotals(receipts, '2026-10', 3);
    expect(t).toEqual([
      { key: '2026-08', cents: 0 },
      { key: '2026-09', cents: 4000 },
      { key: '2026-10', cents: 10000 },
    ]);
    expect(monthTotals([], '2026-01', 2).map((m) => m.key)).toEqual(['2025-12', '2026-01']);
  });

  it('keys months in local time', () => {
    expect(monthKey(dateToMs('2026-10-31')!)).toBe('2026-10');
  });

  it('exports CSV with quoting', () => {
    const csv = toCsv([receipts[3]], { alex: { name: 'Alex', color: '' } });
    expect(csv.split('\n')).toEqual([
      'Date,Store,Paid by,Cards,Item,Printed as,Qty,Line total,Receipt total',
      '2026-09-15,Harris Teeter,Alex,,"Milk ""2%""","Milk, 2%",1,40.00,40.00',
    ]);
  });

  it('exports cards, tips and total-only receipts', () => {
    const tip: Receipt = {
      ...receipts[3],
      kind: 'tip',
      lines: [],
      totalCents: 500,
      payments: [{ card: 'Target Mastercard', last4: '8759', cents: 500 }],
    };
    expect(toCsv([tip], { alex: { name: 'Alex', color: '' } }).split('\n')[1]).toBe(
      '2026-09-15,Harris Teeter,Alex,Target Mastercard *8759 5.00,Shopper tip,,1,5.00,5.00',
    );
  });

  it('totals by card, with uncovered amounts as unknown', () => {
    const split: Receipt = {
      ...receipts[3],
      totalCents: 5454,
      payments: [
        { card: 'Target Mastercard', last4: '8759', cents: 1950 },
        { card: 'Target Circle Credit Card', last4: '3979', cents: 3004 },
      ],
    };
    const tip: Receipt = { ...receipts[3], kind: 'tip', totalCents: 500, payments: [] };
    const s = summarizeMonth([split, tip], '2026-09');
    expect(s.byCard).toEqual([
      { key: '3979', cents: 3004 },
      { key: '8759', cents: 1950 },
      { key: '', cents: 1000 },
    ]);
    expect(s.cardNames['8759']).toBe('Target Mastercard');
    expect(s.tipsCents).toBe(500);
    expect(cardsLabel(split)).toBe('•8759 + •3979');
  });
});

describe('price history', () => {
  const milk = { id: 'milk1', normalizedName: 'oat milk' };
  const r = (store: Receipt['store'], date: string, lines: Receipt['lines']): Receipt => ({
    ...receipt(store, date, 0),
    lines,
  });
  const receipts = [
    r('ht', '2026-10-01', [
      { raw: 'OATLY', name: 'Oat milk', qty: 2, cents: 918, itemId: 'milk1' },
    ]),
    r('target', '2026-10-10', [
      { raw: 'OAT', name: 'Oat milk', qty: 1, cents: 429, itemId: 'old', itemKey: 'oat milk' },
    ]),
    r('ht', '2026-10-20', [
      { raw: 'OATLY', name: 'Oat milk', qty: 1, cents: 499, itemId: 'milk1' },
      { raw: 'GUM', name: 'Gum', qty: 1, cents: 100, itemId: 'gum' },
    ]),
  ];

  it('collects unit prices newest first, by id or by name', () => {
    expect(priceHistory(receipts, milk).map((p) => [p.store, p.unitCents])).toEqual([
      ['ht', 499],
      ['target', 429],
      ['ht', 459],
    ]);
  });

  it('keeps the latest per store, cheapest first', () => {
    expect(latestByStore(priceHistory(receipts, milk)).map((p) => [p.store, p.unitCents])).toEqual([
      ['target', 429],
      ['ht', 499],
    ]);
  });
});

describe('monthLabel', () => {
  it('includes the year', () => {
    expect(monthLabel('2026-11')).toMatch(/2026$/);
    expect(monthLabel('2025-10', 'short')).toMatch(/’25$/);
  });
});

describe('cards', () => {
  it('reads payments from the receipt reader, keeping only the last 4 digits', () => {
    const d = fromModel(
      {
        store: 'ht',
        total: 20,
        payments: [
          { card: 'VISA', last4: '****1234', amount: 15 },
          { card: 'Cash', last4: '', amount: 5 },
          { card: '', last4: '' },
        ],
      },
      'u1',
    );
    expect(d.payments).toEqual([
      { card: 'VISA', last4: '1234', cents: 1500 },
      { card: 'Cash', last4: '', cents: 500 },
    ]);
  });

  it('knows each card and who usually pays with it', () => {
    const base = { ...receipt('target', '2026-10-01', 1000) };
    const rs: Receipt[] = [
      { ...base, paidBy: 'm', payments: [{ card: 'Mastercard', last4: '8759', cents: 1000 }] },
      { ...base, paidBy: 'm', payments: [{ card: 'Mastercard', last4: '8759', cents: 900 }] },
      {
        ...base,
        paidBy: 'j',
        payments: [
          { card: 'Mastercard', last4: '8759', cents: 100 },
          { card: 'Circle', last4: '3979', cents: 900 },
        ],
      },
      { ...base, paidBy: 'x', payments: [{ card: 'Coupon', last4: '', cents: 50 }] },
    ];
    expect(knownCards(rs)).toEqual([
      { last4: '8759', card: 'Mastercard', count: 3, owner: 'm' },
      { last4: '3979', card: 'Circle', count: 1, owner: 'j' },
    ]);
    expect(singlePayment({ card: 'Circle', last4: '3979' }, 1234)).toEqual([
      { card: 'Circle', last4: '3979', cents: 1234 },
    ]);
    expect(singlePayment(null, 1234)).toBeUndefined();
  });
});

describe('shortCardName', () => {
  it('drops the store and "card" words', () => {
    expect(shortCardName('Target Circle Credit Card')).toBe('Circle');
    expect(shortCardName('Target Mastercard')).toBe('Mastercard');
    expect(shortCardName('Target GiftCard')).toBe('GiftCard');
    expect(shortCardName('Visa')).toBe('Visa');
    expect(shortCardName('Gift card')).toBe('Gift');
    expect(shortCardName(undefined)).toBe('Card');
  });
});

describe('budgetCrossed', () => {
  it('reports the highest line a receipt crossed, once', () => {
    expect(budgetCrossed(40000, 50000, 60000)).toBe(80);
    expect(budgetCrossed(50000, 61000, 60000)).toBe(100);
    expect(budgetCrossed(40000, 61000, 60000)).toBe(100);
    expect(budgetCrossed(47000, 49000, 60000)).toBe(80);
    expect(budgetCrossed(50000, 55000, 60000)).toBeNull();
    expect(budgetCrossed(61000, 70000, 60000)).toBeNull();
    expect(budgetCrossed(0, 70000, null)).toBeNull();
  });
});

describe('priceTrends', () => {
  const day = 86_400_000;
  it('compares the first and latest price per store, two weeks apart or more', () => {
    const t = priceTrends([
      { store: 'target', unitCents: 500, at: 0 },
      { store: 'target', unitCents: 550, at: 20 * day },
      { store: 'target', unitCents: 590, at: 40 * day },
      { store: 'ht', unitCents: 600, at: 0 },
      { store: 'ht', unitCents: 540, at: 30 * day },
      { store: 'amazon', unitCents: 900, at: 0 },
      { store: 'amazon', unitCents: 990, at: 3 * day }, // too close together
    ]);
    expect(t.map((x) => [x.store, Math.round(x.change * 100)])).toEqual([
      ['target', 18],
      ['ht', -10],
    ]);
  });
});

describe('monthRecap', () => {
  it('totals the month, counts purchases (not tips) and finds the top store', () => {
    const base = receipt('target', '2026-10-05', 10000);
    const rs: Receipt[] = [
      base,
      { ...receipt('ht', '2026-10-09', 4000) },
      { ...receipt('target', '2026-10-09', 500), kind: 'tip' },
      receipt('target', '2026-11-01', 9999),
    ];
    expect(monthRecap(rs, '2026-10')).toEqual({
      month: '2026-10',
      cents: 14500,
      receipts: 2,
      topStore: 'target',
      topCents: 10500,
    });
  });
});
