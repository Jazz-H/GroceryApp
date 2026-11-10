import { describe, expect, it } from 'vitest';
import type { CatalogEntry } from '../types';
import { quickEntries } from './quickList';
import { makeItem, price } from './testItems';
import { catalogKey } from './usuals';

const entry = (name: string, count: number, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  key: catalogKey(name),
  name,
  count,
  addedAt: [],
  stores: ['target'],
  storeInfo: {},
  ...extra,
});

describe('quickEntries', () => {
  const catalog = [
    entry('Eggs', 1, { storeInfo: { target: { price: price(169) } } }),
    entry('Bananas', 5),
    entry('Apples', 1),
    entry('Spinach', 2, { stores: ['ht'] }),
  ];

  it('lists most-bought first, then A–Z, with prices and on-list state', () => {
    const items = [makeItem('Eggs', ['target'])];
    const out = quickEntries(catalog, items, 'all');
    expect(out.map((e) => e.name)).toEqual(['Bananas', 'Spinach', 'Apples', 'Eggs']);
    expect(out.find((e) => e.name === 'Eggs')).toMatchObject({ cents: 169, onList: true });
    expect(out.find((e) => e.name === 'Spinach')).toMatchObject({ store: 'ht', onList: false });
  });

  it('filters by store and search', () => {
    expect(quickEntries(catalog, [], 'ht').map((e) => e.name)).toEqual(['Spinach']);
    expect(quickEntries(catalog, [], 'all', 'APP').map((e) => e.name)).toEqual(['Apples']);
  });

  it('checked items and nice-to-haves are not "on the list"', () => {
    const items = [
      makeItem('Eggs', ['target'], {}, { status: 'checked' }),
      makeItem('Apples', ['target'], {}, { list: 'nice' }),
    ];
    const out = quickEntries(catalog, items, 'all');
    expect(out.every((e) => !e.onList)).toBe(true);
  });
});
