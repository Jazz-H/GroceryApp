import { describe, expect, it } from 'vitest';
import type { ActivityEvent, CatalogEntry } from '../types';
import { makeItem } from './testItems';
import { catalogKey, nextAddedAt, suggestUsuals } from './usuals';

const DAY = 86_400_000;
const NOW = 100 * DAY;

function entry(name: string, daysAgo: number[], extra: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    key: catalogKey(name),
    name,
    count: daysAgo.length,
    addedAt: daysAgo.map((d) => NOW - d * DAY),
    stores: ['ht'],
    storeInfo: {},
    ...extra,
  };
}

function add(name: string, daysAgo: number, store: ActivityEvent['store'] = 'ht'): ActivityEvent {
  return {
    id: `${name}-${daysAgo}`,
    actorId: 'u1',
    type: 'add',
    itemIds: ['x'],
    itemNames: [name],
    batchId: 'b',
    store,
    at: NOW - daysAgo * DAY,
  };
}

describe('nextAddedAt', () => {
  it('keeps the newest six, oldest first', () => {
    expect(nextAddedAt([1, 2, 3, 4, 5, 6], 7)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(nextAddedAt(undefined, 5)).toEqual([5]);
  });
});

describe('suggestUsuals', () => {
  it('suggests weekly items once most of a week has passed', () => {
    const milk = entry('Milk', [26, 19, 12, 5]); // weekly, last 5 days ago
    const s = suggestUsuals([milk], [], [], NOW);
    expect(s.map((u) => u.name)).toEqual(['Milk']);
    expect(s[0].daysSince).toBe(5);
  });

  it('waits when an item was just bought', () => {
    const milk = entry('Milk', [21, 14, 7, 1]); // weekly, last 1 day ago
    expect(suggestUsuals([milk], [], [], NOW)).toEqual([]);
  });

  it('skips anything already on the list', () => {
    const milk = entry('Milk', [26, 19, 12, 5]);
    expect(suggestUsuals([milk], [], [makeItem('milk', ['ht'])], NOW)).toEqual([]);
  });

  it('ranks overdue regulars above one-offs', () => {
    const s = suggestUsuals(
      [entry('Eggs', [30, 20, 10]), entry('Saffron', [40]), entry('Milk', [21, 14, 7])],
      [],
      [],
      NOW,
    );
    expect(s.map((u) => u.name)).toEqual(['Eggs', 'Milk', 'Saffron']);
  });

  it('ignores one-offs from the last few days', () => {
    expect(suggestUsuals([entry('Cake', [2])], [], [], NOW)).toEqual([]);
  });

  it('uses the store it was last bought at', () => {
    const s = suggestUsuals([entry('Coffee', [20, 10], { stores: ['target', 'ht'] })], [], [], NOW);
    expect(s[0].store).toBe('target');
  });

  it('fills in from the activity log for items the catalog never saw', () => {
    const s = suggestUsuals(
      [],
      [add('Bananas', 15, 'target'), add('Bananas', 8, 'target')],
      [],
      NOW,
    );
    expect(s).toEqual([{ key: 'bananas', name: 'Bananas', store: 'target', daysSince: 8 }]);
  });

  it('prefers the catalog over the log for the same item', () => {
    const s = suggestUsuals([entry('Bananas', [30, 2])], [add('Bananas', 40)], [], NOW);
    expect(s).toEqual([]);
  });

  it('caps the number of suggestions', () => {
    const many = Array.from({ length: 12 }, (_, i) => entry(`Item ${i}`, [20, 10]));
    expect(suggestUsuals(many, [], [], NOW, 8)).toHaveLength(8);
  });
});
