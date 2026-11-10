import { describe, expect, it } from 'vitest';
import { aisleLabel, aisleSortKey, buildBoard, NOT_PLACED, ORDERED } from './aisles';
import { DEFAULT_ZONE_ORDER } from './stores';
import { aisle, makeItem } from './testItems';

const HT = DEFAULT_ZONE_ORDER.ht!;

describe('aisleSortKey', () => {
  it('orders zones and numbered aisles by walking order', () => {
    const labels = ['Dairy', '12', 'Produce', '4', 'Bakery', 'Frozen', 'Aisle 7'];
    const sorted = [...labels].sort((a, b) => aisleSortKey(a, HT) - aisleSortKey(b, HT));
    expect(sorted).toEqual(['Produce', 'Bakery', '4', 'Aisle 7', '12', 'Frozen', 'Dairy']);
  });

  it('sorts Target-style letter aisles by letter then number', () => {
    const labels = ['G14', 'C3', 'G2', 'E8'];
    expect([...labels].sort((a, b) => aisleSortKey(a) - aisleSortKey(b))).toEqual([
      'C3',
      'E8',
      'G2',
      'G14',
    ]);
  });

  it('is case-insensitive for zones', () => {
    expect(aisleSortKey('produce', HT)).toBe(aisleSortKey('Produce', HT));
  });

  it('puts empty last and unknown zones after known ones', () => {
    expect(aisleSortKey('', HT)).toBe(Infinity);
    expect(aisleSortKey('Pharmacy', HT)).toBeGreaterThan(aisleSortKey('Dairy', HT));
    expect(aisleSortKey('Pharmacy', HT)).toBeLessThan(Infinity);
  });

  it('handles aisle suffixes like 12A and 12B', () => {
    expect(aisleSortKey('12A')).toBeLessThan(aisleSortKey('12B'));
    expect(aisleSortKey('12B')).toBeLessThan(aisleSortKey('13'));
  });
});

describe('aisleLabel', () => {
  it('formats labels for headings', () => {
    expect(aisleLabel('7')).toBe('Aisle 7');
    expect(aisleLabel('aisle 7')).toBe('Aisle 7');
    expect(aisleLabel('g14')).toBe('Aisle G14');
    expect(aisleLabel('produce')).toBe('Produce');
    expect(aisleLabel('')).toBe('');
  });
});

describe('buildBoard', () => {
  const spinach = makeItem('Spinach', ['ht'], { ht: { aisle: aisle('Produce') } });
  const milk = makeItem('Oat milk', ['ht', 'target'], { ht: { aisle: aisle('7') } });
  const yogurt = makeItem('Greek yogurt', ['ht']);
  const soap = makeItem('Dish soap', ['target'], { target: { aisle: aisle('G14') } });
  const filters = makeItem('Coffee filters', ['amazon']);
  const items = [milk, soap, yogurt, filters, spinach];

  it('keeps the order things were added when not sorting', () => {
    const rows = buildBoard(items, {
      store: 'all',
      sortByAisle: false,
      zoneOrder: DEFAULT_ZONE_ORDER,
    });
    // Created in this order above: spinach, milk, yogurt, soap, filters.
    expect(rows.map((r) => (r.type === 'item' ? r.item.name : r.label))).toEqual([
      'Spinach',
      'Oat milk',
      'Greek yogurt',
      'Dish soap',
      'Coffee filters',
    ]);
  });

  it('filters to one store and groups by aisle with not-placed last', () => {
    const rows = buildBoard(items, {
      store: 'ht',
      sortByAisle: true,
      zoneOrder: DEFAULT_ZONE_ORDER,
    });
    expect(rows.map((r) => (r.type === 'item' ? r.item.name : `# ${r.label}`))).toEqual([
      '# Produce',
      'Spinach',
      '# Aisle 7',
      'Oat milk',
      `# ${NOT_PLACED}`,
      'Greek yogurt',
    ]);
  });

  it('includes items whose second store matches the pill', () => {
    const rows = buildBoard(items, { store: 'target', sortByAisle: false, zoneOrder: {} });
    expect(rows.map((r) => r.type === 'item' && r.item.name)).toEqual(['Oat milk', 'Dish soap']);
  });

  it('groups by main store then aisle in All view', () => {
    const rows = buildBoard(items, {
      store: 'all',
      sortByAisle: true,
      zoneOrder: DEFAULT_ZONE_ORDER,
    });
    expect(rows.map((r) => (r.type === 'item' ? r.item.name : `${r.type}:${r.label}`))).toEqual([
      'store:Harris Teeter',
      'aisle:Produce',
      'Spinach',
      'aisle:Aisle 7',
      'Oat milk',
      `aisle:${NOT_PLACED}`,
      'Greek yogurt',
      'store:Target',
      'aisle:Aisle G14',
      'Dish soap',
      'store:Amazon',
      'Coffee filters',
    ]);
  });
});

describe('ordered items', () => {
  it('go last, under their own heading, whatever the sort', () => {
    const milk = makeItem('Milk', ['target'], {}, { status: 'ordered' });
    const eggs = makeItem('Eggs', ['target']);
    for (const sortByAisle of [false, true]) {
      const rows = buildBoard([milk, eggs], { store: 'target', sortByAisle, zoneOrder: {} });
      const labels = rows.map((r) => (r.type === 'item' ? r.item.name : r.label));
      expect(labels.slice(-2)).toEqual([ORDERED, 'Milk']);
      expect(labels).toContain('Eggs');
    }
  });
});
