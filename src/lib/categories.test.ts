import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  categoryOf,
  guessCategory,
  isCategoryId,
  learnedCategories,
  spendByCategory,
  zoneForCategory,
} from './categories';
import { DEFAULT_ZONE_ORDER } from './stores';
import type { ReceiptLine } from '../types';

describe('guessCategory', () => {
  const cases: [string, string][] = [
    ['Bananas', 'produce'],
    ['Organic baby spinach', 'produce'],
    ['Bell peppers', 'produce'],
    ['Avocados x4', 'produce'],
    ['Chicken thighs', 'meat'],
    ['Ground beef 80/20', 'meat'],
    ['Salmon fillets', 'meat'],
    ['Oat milk', 'dairy'],
    ['Eggs', 'dairy'],
    ['Greek yogurt', 'dairy'],
    ['Shredded cheddar cheese', 'dairy'],
    ['Sourdough bread', 'bakery'],
    ['Flour tortillas', 'pantry'], // "flour" is checked before bakery; still a sensible shelf
    ['Hummus', 'deli'],
    ['Frozen peas', 'frozen'],
    ['Ice cream', 'frozen'],
    ['Chicken broth', 'pantry'],
    ['Peanut butter', 'pantry'],
    ['Black pepper', 'pantry'],
    ['Spaghetti', 'pantry'],
    ['Tortilla chips', 'snacks'],
    ['Sparkling water', 'drinks'],
    ['Coffee beans', 'drinks'],
    ['Paper towels', 'household'],
    ['Dish soap', 'household'],
    ['Toothpaste', 'personal'],
    ['Diapers size 3', 'baby'],
    ['Dog food', 'pet'],
    ['Birthday card', 'other'],
    ['', 'other'],
  ];
  it.each(cases)('%s → %s', (name, expected) => {
    expect(guessCategory(name)).toBe(expected);
  });

  it('matches whole words only', () => {
    expect(guessCategory('Eggplant')).toBe('other');
    expect(guessCategory('Rice')).toBe('pantry'); // not "ice"
  });

  it('reads tidied receipt names', () => {
    expect(guessCategory('HT ORG SPINACH 10Z')).toBe('produce');
    expect(guessCategory('Kroger 2% milk, gallon')).toBe('dairy');
  });
});

describe('categoryOf', () => {
  it('prefers the item, then what you set before for the name, then a guess', () => {
    const learned = learnedCategories([{ key: 'greek yogurt', category: 'snacks' }]);
    expect(categoryOf({ name: 'Greek yogurt', category: 'frozen' }, learned)).toBe('frozen');
    expect(categoryOf({ name: 'Greek Yogurt!' }, learned)).toBe('snacks');
    expect(categoryOf({ name: 'Greek yogurt' })).toBe('dairy');
  });
});

describe('zoneForCategory', () => {
  it('finds the zone in the store’s order, ignoring case', () => {
    expect(zoneForCategory('meat', DEFAULT_ZONE_ORDER.ht!)).toBe('Meat & Seafood');
    expect(zoneForCategory('produce', ['produce', 'Aisles'])).toBe('produce');
  });
  it('has none for shelf categories or stores without that zone', () => {
    expect(zoneForCategory('pantry', DEFAULT_ZONE_ORDER.ht!)).toBeUndefined();
    expect(zoneForCategory('dairy', DEFAULT_ZONE_ORDER.target!)).toBeUndefined();
  });
});

it('knows its own ids', () => {
  for (const c of CATEGORIES) expect(isCategoryId(c.id)).toBe(true);
  expect(isCategoryId('meats')).toBe(false);
});

describe('spendByCategory', () => {
  const line = (name: string, cents: number, extra: Partial<ReceiptLine> = {}): ReceiptLine => ({
    raw: name.toUpperCase(),
    name,
    qty: 1,
    cents,
    itemId: null,
    ...extra,
  });

  it('groups item lines by category and keeps tax, fees and discounts apart', () => {
    const r = {
      totalCents: 1500,
      lines: [line('Bananas', 300), line('Apples', 400), line('Milk', 500), line('Coupon', -100)],
    };
    const out = spendByCategory([r], new Map());
    expect(out.slices.map((s) => [s.key, s.cents])).toEqual([
      ['produce', 700],
      ['dairy', 500],
    ]);
    expect(out.slices[0].lines.map((l) => l.name)).toEqual(['Apples', 'Bananas']);
    // 1500 total − 1200 in lines = tax/fees net of the coupon.
    expect(out.otherCents).toBe(300);
    expect(out.notItemizedCents).toBe(0);
  });

  it('merges the same name across receipts', () => {
    const out = spendByCategory(
      [
        { totalCents: 300, lines: [line('Bananas', 300)] },
        { totalCents: 250, lines: [line('bananas', 250)] },
      ],
      new Map(),
    );
    expect(out.slices[0].lines).toEqual([{ name: 'Bananas', cents: 550, count: 2 }]);
  });

  it('uses the matched item’s category, then what you set for the name, then a guess', () => {
    const items = [{ id: 'i1', name: 'Yogurt', category: 'snacks' as const }];
    const learned = new Map([['milk', 'drinks' as const]]);
    const out = spendByCategory(
      [
        {
          totalCents: 900,
          lines: [line('Greek yog', 300, { itemId: 'i1' }), line('Milk', 300), line('Eggs', 300)],
        },
      ],
      learned,
      items,
    );
    const keys = Object.fromEntries(out.slices.map((s) => [s.key, s.lines.map((l) => l.name)]));
    expect(keys).toEqual({ snacks: ['Yogurt'], drinks: ['Milk'], dairy: ['Eggs'] });
  });

  it('counts total-only receipts as not itemized and skips tips', () => {
    const out = spendByCategory(
      [
        { totalCents: 4000, lines: [] },
        { kind: 'tip', totalCents: 500, lines: [] },
      ],
      new Map(),
    );
    expect(out).toEqual({ slices: [], otherCents: 0, notItemizedCents: 4000 });
  });
});
