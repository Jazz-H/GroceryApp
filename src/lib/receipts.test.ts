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
  monthTotals,
  msToDate,
  summarizeMonth,
  toCsv,
  unitCents,
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
      'Date,Store,Paid by,Item,Printed as,Qty,Line total,Receipt total',
      '2026-09-15,Harris Teeter,Alex,"Milk ""2%""","Milk, 2%",1,40.00,40.00',
    ]);
  });
});
