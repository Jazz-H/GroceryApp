import { describe, expect, it } from 'vitest';
import {
  MAX_SPOKEN_ITEMS,
  openGroceryNames,
  parseSpoken,
  splitDuplicates,
  spokenReply,
} from './voice';

const names = (text: string) =>
  parseSpoken(text).map((q) => (q.qty > 1 ? `${q.qty} ${q.name}` : q.name));

describe('parseSpoken', () => {
  it('splits on commas and "and"', () => {
    expect(names('milk, eggs and bread')).toEqual(['Milk', 'Eggs', 'Bread']);
    expect(names('Milk and eggs and bread')).toEqual(['Milk', 'Eggs', 'Bread']);
  });

  it('drops "add …" and "… to the list"', () => {
    expect(names('Add bananas to the list.')).toEqual(['Bananas']);
    expect(names('please add oat milk to my shopping list')).toEqual(['Oat milk']);
    expect(names('put coffee on the list')).toEqual(['Coffee']);
  });

  it('keeps names that have "and" in them', () => {
    expect(names('mac and cheese and half and half')).toEqual(['Mac and cheese', 'Half and half']);
    expect(names('salt and vinegar chips, plus apples')).toEqual([
      'Salt and vinegar chips',
      'Apples',
    ]);
  });

  it('reads spoken and typed numbers', () => {
    expect(names('two avocados and 3 limes')).toEqual(['2 Avocados', '3 Limes']);
    expect(names('a dozen eggs')).toEqual(['12 Eggs']);
    expect(names('an onion')).toEqual(['Onion']);
  });

  it('drops repeats and empty bits, and caps the count', () => {
    expect(names('milk, , Milk and')).toEqual(['Milk']);
    expect(names('')).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `thing${i}`).join(', ');
    expect(parseSpoken(many)).toHaveLength(MAX_SPOKEN_ITEMS);
  });
});

describe('spokenReply', () => {
  it('says what was added and what was already there', () => {
    expect(spokenReply(['Milk'], [])).toBe('Added milk.');
    expect(spokenReply(['Milk', 'Eggs', 'Bread'], [])).toBe('Added milk, eggs and bread.');
    expect(spokenReply(['Milk'], ['Eggs'])).toBe('Added milk. Eggs is already on the list.');
    expect(spokenReply([], ['Eggs', 'Bread'])).toBe('Eggs and Bread are already on the list.');
    expect(spokenReply([], [])).toBe('I didn’t catch any items.');
  });
});

describe('duplicates', () => {
  const items = [
    { name: 'Milk', normalizedName: 'milk', list: 'grocery', status: 'open' },
    { name: 'Avocados', normalizedName: 'avocados', list: 'grocery', status: 'ordered' },
    { name: 'Tomato', normalizedName: 'tomato', list: 'grocery', status: 'open' },
    { name: 'Eggs', normalizedName: 'eggs', list: 'grocery', status: 'checked' },
    { name: 'Candles', normalizedName: 'candles', list: 'nice', status: 'open' },
  ];

  it('snapshots what’s on the Grocery list, open or ordered', () => {
    expect(openGroceryNames(items)).toEqual(['avocados', 'milk', 'tomato']);
  });

  it('finds items already on the list, singular or plural', () => {
    const spoken = parseSpoken('milk, an avocado, tomatoes, eggs and candles');
    const { fresh, already } = splitDuplicates(spoken, openGroceryNames(items));
    expect(already.map((q) => q.name)).toEqual(['Milk', 'Avocado', 'Tomatoes']);
    // Checked off, or only on Nice-to-have: add them.
    expect(fresh.map((q) => q.name)).toEqual(['Eggs', 'Candles']);
  });
});
