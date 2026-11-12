import { describe, expect, it } from 'vitest';
import { createBatcher, describe as describeGroup, groupFeed, timeAgo } from './activity';
import type { ActivityEvent } from '../types';

describe('createBatcher', () => {
  it('reuses a batch inside the window and starts a new one after', () => {
    let t = 0;
    let n = 0;
    const next = createBatcher(
      () => t,
      () => `b${++n}`,
    );
    expect(next()).toBe('b1');
    t = 30_000;
    expect(next()).toBe('b1');
    t = 85_000; // 55s after the last add: still inside
    expect(next()).toBe('b1');
    t = 150_000;
    expect(next()).toBe('b2');
  });
});

const ev = (id: string, p: Partial<ActivityEvent>): ActivityEvent => ({
  id,
  actorId: 'sam',
  type: 'add',
  itemIds: [id],
  itemNames: [id],
  batchId: 'b1',
  at: 0,
  ...p,
});

describe('groupFeed', () => {
  it('merges adds in the same batch into one entry', () => {
    const groups = groupFeed([
      ev('Milk', {}),
      ev('Eggs', {}),
      ev('Bread', {}),
      ev('Soap', { batchId: 'b0' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].count).toBe(3);
    expect(groups[0].itemNames).toEqual(['Milk', 'Eggs', 'Bread']);
  });
  it('does not merge different people or different actions', () => {
    const groups = groupFeed([
      ev('Milk', {}),
      ev('Eggs', { actorId: 'alex' }),
      ev('Bread', { type: 'check' }),
    ]);
    expect(groups).toHaveLength(3);
  });
  it('never merges moves or edits', () => {
    const groups = groupFeed([ev('Milk', { type: 'move' }), ev('Eggs', { type: 'move' })]);
    expect(groups).toHaveLength(2);
  });
});

describe('describe', () => {
  const sam = { name: 'Sam', color: '#d4466a' };
  it('summarizes grouped adds', () => {
    const [g] = groupFeed([ev('Milk', {}), ev('Eggs', {})]);
    expect(describeGroup(g, sam)).toBe('Sam added 2 items');
  });
  it('names single items and trips', () => {
    const [g] = groupFeed([ev('Milk', {})]);
    expect(describeGroup(g, sam)).toBe('Sam added Milk');
    const [t] = groupFeed([
      ev('x', { type: 'trip_start', itemNames: [], store: 'target', detail: 'solo' }),
    ]);
    expect(describeGroup(t, sam)).toBe('Sam started a solo trip to Target');
    const [j] = groupFeed([ev('x', { type: 'trip_join', itemNames: [], store: 'ht' })]);
    expect(describeGroup(j, sam)).toBe('Sam joined the trip to Harris Teeter');
    const [o] = groupFeed([
      ev('x', { type: 'order', itemNames: ['Milk', 'Eggs'], store: 'target' }),
    ]);
    expect(describeGroup(o, sam)).toBe('Sam placed a Target order (2 items)');
    const [p] = groupFeed([ev('x', { type: 'pickup', itemNames: ['Milk'], store: 'target' })]);
    expect(describeGroup(p, sam)).toBe('Sam picked up the Target order');
  });
});

describe('timeAgo', () => {
  it('formats recent times', () => {
    expect(timeAgo(0, 10_000)).toBe('just now');
    expect(timeAgo(0, 5 * 60_000)).toBe('5m ago');
    expect(timeAgo(0, 3 * 3_600_000)).toBe('3h ago');
  });
});

it('marks adds made by voice', () => {
  const group = groupFeed([
    {
      id: 'v1',
      actorId: 'a',
      type: 'add',
      itemIds: ['i'],
      itemNames: ['Milk'],
      batchId: 'b',
      detail: 'voice',
      at: 1,
    },
  ])[0];
  expect(describeGroup(group, { name: 'Alex', color: '#000' })).toBe('Alex added Milk by voice');
});
