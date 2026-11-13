import { describe, expect, it } from 'vitest';
import {
  cheapestPerUnit,
  comparable,
  formatSize,
  formatUnitPrice,
  parseSize,
  unitPrice,
} from './units';

describe('parseSize', () => {
  it.each([
    ['64 oz', 'oz', 64, 'weight'],
    ['64oz', 'oz', 64, 'weight'],
    ['1.5 lb', 'lb', 24, 'weight'],
    ['2 lbs', 'lb', 32, 'weight'],
    ['1 gal', 'gal', 128, 'volume'],
    ['½ gal', 'gal', 64, 'volume'],
    ['32 fl oz', 'fl oz', 32, 'volume'],
    ['32 fl. oz.', 'fl oz', 32, 'volume'],
    ['12-ct', 'ct', 12, 'count'],
    ['2 x 6 pk', 'ct', 12, 'count'],
    ['18 count', 'ct', 18, 'count'],
    ['12 rolls', 'ct', 12, 'count'],
  ])('%s → %s', (text, unit, base, family) => {
    const s = parseSize(text)!;
    expect(s.unit).toBe(unit);
    expect(s.base).toBeCloseTo(base as number, 3);
    expect(s.family).toBe(family);
  });

  it('converts metric', () => {
    expect(parseSize('500 g')!.base).toBeCloseTo(17.637, 2);
    expect(parseSize('1 L')!.base).toBeCloseTo(33.814, 2);
    expect(parseSize('750 ml')!.base).toBeCloseTo(25.36, 1);
  });

  it('says no to things that aren’t sizes', () => {
    for (const t of ['', 'big', 'oz', '12', '0 oz', '3 bananas']) expect(parseSize(t)).toBeNull();
  });

  it('writes sizes back tidily', () => {
    expect(formatSize(parseSize('64OZ')!)).toBe('64 oz');
    expect(formatSize(parseSize('1.50 lb')!)).toBe('1.5 lb');
  });
});

describe('unit prices', () => {
  it('prices per oz, fl oz or each', () => {
    expect(formatUnitPrice(unitPrice(399, parseSize('64 oz'))!)).toBe('$0.062/oz');
    expect(formatUnitPrice(unitPrice(1299, parseSize('12 ct'))!)).toBe('$1.08 each');
    expect(formatUnitPrice(unitPrice(459, parseSize('1 gal'))!)).toBe('$0.036/fl oz');
    expect(unitPrice(undefined, parseSize('1 gal'))).toBeNull();
    expect(unitPrice(300, null)).toBeNull();
  });

  it('compares a plain oz with liquids, but never weight with counts', () => {
    const oz = unitPrice(399, parseSize('64 oz'))!;
    const gal = unitPrice(459, parseSize('1 gal'))!;
    const lb = unitPrice(500, parseSize('2 lb'))!;
    const ct = unitPrice(500, parseSize('12 ct'))!;
    const floz = unitPrice(300, parseSize('32 fl oz'))!;
    expect(comparable(oz, gal)).toBe(true);
    expect(comparable(oz, lb)).toBe(true);
    expect(comparable(lb, floz)).toBe(false);
    expect(comparable(oz, ct)).toBe(false);
  });

  it('finds the cheapest store per unit', () => {
    const best = cheapestPerUnit([
      { store: 'ht', unit: unitPrice(399, parseSize('64 oz'))! }, // 6.2¢/oz
      { store: 'target', unit: unitPrice(459, parseSize('1 gal'))! }, // 3.6¢/fl oz
    ]);
    expect(best).toEqual({ store: 'target', runnerUp: 'ht', pctCheaper: 42 });
    expect(
      cheapestPerUnit([{ store: 'ht', unit: unitPrice(399, parseSize('64 oz'))! }]),
    ).toBeNull();
    expect(
      cheapestPerUnit([
        { store: 'ht', unit: unitPrice(500, parseSize('2 lb'))! },
        { store: 'target', unit: unitPrice(500, parseSize('12 ct'))! },
      ]),
    ).toBeNull();
  });
});
