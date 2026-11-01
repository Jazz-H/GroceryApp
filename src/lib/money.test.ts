import { describe, expect, it } from 'vitest';
import { estimate, formatCents, parsePrice } from './money';
import { makeItem, price } from './testItems';

describe('parsePrice', () => {
  it('accepts common formats', () => {
    expect(parsePrice('3.99')).toBe(399);
    expect(parsePrice('$3.99')).toBe(399);
    expect(parsePrice(' 4 ')).toBe(400);
    expect(parsePrice('4.5')).toBe(450);
    expect(parsePrice('1,024.00')).toBe(102400);
  });
  it('rejects junk', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('abc')).toBeNull();
    expect(parsePrice('3.999')).toBeNull();
    expect(parsePrice('-2')).toBeNull();
  });
});

describe('formatCents', () => {
  it('formats dollars', () => {
    expect(formatCents(399)).toBe('$3.99');
    expect(formatCents(0)).toBe('$0.00');
  });
});

describe('estimate', () => {
  const pizza = makeItem('Pizza', ['ht'], { ht: { price: price(699) } }, { qty: 2 });
  const milk = makeItem('Milk', ['ht', 'target'], {
    ht: { price: price(399) },
    target: { price: price(429) },
  });
  const bananas = makeItem('Bananas', ['ht']);
  const done = makeItem('Sauce', ['ht'], { ht: { price: price(279) } }, { status: 'checked' });
  const items = [pizza, milk, bananas, done];

  it('multiplies by quantity, skips checked, counts missing prices', () => {
    expect(estimate(items, 'ht')).toEqual({ cents: 699 * 2 + 399, open: 3, missing: 1 });
  });
  it('uses the store pill price for multi-store items', () => {
    expect(estimate(items, 'target')).toEqual({ cents: 429, open: 1, missing: 0 });
  });
  it('uses the main store in All view', () => {
    expect(estimate(items, 'all').cents).toBe(699 * 2 + 399);
  });
});
