import { describe, expect, it } from 'vitest';
import { parseImport, splitCsvLine } from './importList';

describe('splitCsvLine', () => {
  it('keeps quoted commas', () => {
    expect(splitCsvLine('"Toilet paper, 24 rolls",39.99,target')).toEqual([
      'Toilet paper, 24 rolls',
      '39.99',
      'target',
    ]);
    expect(splitCsvLine('"He said ""hi""",1')).toEqual(['He said "hi"', '1']);
  });
});

describe('parseImport', () => {
  it('reads a CSV with a header', () => {
    const csv =
      'name,price,qty,store,note\nBananas,0.29,6,Target,Good & Gather\n"Toilet paper, 24 rolls",$39.99,1,tgt,\nEggs,,1,HT,';
    expect(parseImport(csv, 'target')).toEqual([
      {
        name: 'Bananas',
        qty: 6,
        store: 'target',
        priceCents: 29,
        priceKind: 'paid',
        note: 'Good & Gather',
      },
      {
        name: 'Toilet paper, 24 rolls',
        qty: 1,
        store: 'target',
        priceCents: 3999,
        priceKind: 'paid',
      },
      { name: 'Eggs', qty: 1, store: 'ht' },
    ]);
  });

  it('reads plain lines with optional prices', () => {
    expect(parseImport('Bananas, 0.29\n2 sour cream $1.99\nmilk', 'target')).toEqual([
      { name: 'Bananas', qty: 1, store: 'target', priceCents: 29, priceKind: 'paid' },
      { name: 'Sour cream', qty: 2, store: 'target', priceCents: 199, priceKind: 'paid' },
      { name: 'Milk', qty: 1, store: 'target' },
    ]);
  });

  it('does not mistake numbers in names for prices', () => {
    expect(parseImport('7up', 'ht')).toEqual([{ name: '7up', qty: 1, store: 'ht' }]);
  });

  it('caps very long imports', () => {
    const many = Array.from({ length: 150 }, (_, i) => `item ${i}x`).join('\n');
    expect(parseImport(many, 'ht')).toHaveLength(100);
  });
});
