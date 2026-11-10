import { describe, expect, it } from 'vitest';
import { buildBoard, NOT_PLACED, ORDERED } from './aisles';
import { cardLook, groupIntoCards, partnerAddsToday } from './cards';
import { DEFAULT_ZONE_ORDER } from './stores';
import { aisle, makeItem } from './testItems';

describe('groupIntoCards', () => {
  const spinach = makeItem('Spinach', ['ht'], { ht: { aisle: aisle('Produce') } });
  const milk = makeItem('Milk', ['ht'], { ht: { aisle: aisle('Dairy') } });
  const yogurt = makeItem('Yogurt', ['ht'], { ht: { aisle: aisle('Dairy') } });
  const soap = makeItem('Dish soap', ['target']);

  it('makes one card per aisle in walking order', () => {
    const rows = buildBoard([milk, spinach, yogurt], {
      store: 'ht',
      sortByAisle: true,
      zoneOrder: DEFAULT_ZONE_ORDER,
    });
    const blocks = groupIntoCards(rows);
    expect(
      blocks.map((b) => (b.kind === 'card' ? [b.title, b.rows.map((r) => r.item.name)] : b.label)),
    ).toEqual([
      ['Produce', ['Spinach']],
      ['Dairy', ['Milk', 'Yogurt']],
    ]);
  });

  it('puts unsorted items in one untitled card', () => {
    const rows = buildBoard([milk, spinach], { store: 'ht', sortByAisle: false, zoneOrder: {} });
    const blocks = groupIntoCards(rows);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'card', title: null });
  });

  it('keeps store headings between cards in All view', () => {
    const rows = buildBoard([spinach, soap], {
      store: 'all',
      sortByAisle: true,
      zoneOrder: DEFAULT_ZONE_ORDER,
    });
    const kinds = groupIntoCards(rows).map((b) =>
      b.kind === 'store' ? 'store:' + b.label : 'card:' + b.title,
    );
    expect(kinds).toEqual([
      'store:Harris Teeter',
      'card:Produce',
      'store:Target',
      `card:${NOT_PLACED}`,
    ]);
  });

  it('never returns empty cards', () => {
    expect(groupIntoCards([{ type: 'aisle', label: 'Dairy' }])).toEqual([]);
  });
});

describe('cardLook', () => {
  it('picks icons by heading', () => {
    expect(cardLook('Produce').ink).toBe('#6fd39b');
    expect(cardLook('Frozen').ink).toBe('#c4aaff');
    expect(cardLook(ORDERED).ink).toBe('#f0b464');
    expect(cardLook(null)).toEqual(cardLook(NOT_PLACED));
    expect(cardLook('Aisle 7').ink).toBe('#c8d0d8');
  });
});

describe('partnerAddsToday', () => {
  it('counts other people’s adds since midnight', () => {
    const now = new Date(2026, 10, 10, 15).getTime();
    const today = new Date(2026, 10, 10, 9).getTime();
    const yesterday = new Date(2026, 10, 9, 22).getTime();
    const counts = partnerAddsToday(
      [
        { actorId: 'sam', type: 'add', itemNames: ['Eggs'], at: today },
        { actorId: 'sam', type: 'add', itemNames: ['Milk', 'Bread'], at: today },
        { actorId: 'sam', type: 'add', itemNames: ['Old'], at: yesterday },
        { actorId: 'me', type: 'add', itemNames: ['Mine'], at: today },
        { actorId: 'sam', type: 'check', itemNames: ['Eggs'], at: today },
      ],
      'me',
      now,
    );
    expect(counts.get('sam')).toBe(3);
    expect(counts.has('me')).toBe(false);
  });
});
