import { describe, expect, it } from 'vitest';
import type { Receipt, Settlement } from '../types';
import { balances } from './settle';

const r = (paidBy: string, cents: number): Receipt => ({
  id: Math.random().toString(36),
  store: 'target',
  purchasedAt: 0,
  paidBy,
  createdBy: paidBy,
  createdAt: 0,
  subtotalCents: cents,
  taxCents: 0,
  savingsCents: 0,
  totalCents: cents,
  lines: [],
});
const s = (from: string, to: string, cents: number): Settlement => ({
  id: 'x',
  from,
  to,
  cents,
  by: from,
  at: 0,
});

describe('balances', () => {
  it('splits shared spending equally and says who owes whom', () => {
    const b = balances([r('j', 10000), r('m', 4000)], [], ['j', 'm']);
    expect(b.net).toEqual({ j: 3000, m: -3000 });
    expect(b.transfers).toEqual([{ from: 'm', to: 'j', cents: 3000 }]);
    expect(b.totalCents).toBe(14000);
  });

  it('counts settlements and ends even', () => {
    const b = balances([r('j', 10000), r('m', 4000)], [s('m', 'j', 3000)], ['j', 'm']);
    expect(b.net).toEqual({ j: 0, m: 0 });
    expect(b.transfers).toEqual([]);
  });

  it('ignores former members and works for one person', () => {
    expect(balances([r('x', 5000), r('j', 2000)], [], ['j', 'm']).transfers).toEqual([
      { from: 'm', to: 'j', cents: 1000 },
    ]);
    expect(balances([r('j', 2000)], [], ['j']).transfers).toEqual([]);
  });
});
