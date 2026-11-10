import { describe, expect, it } from 'vitest';
import { decodeReceiptsHash, encodeReceiptsLink, isDuplicate } from './receiptImport';
import { dateToMs } from './receipts';
import type { Receipt } from '../types';

const sample = {
  store: 'target',
  date: '2026-11-08',
  subtotal: 162.6,
  total: 162.6,
  lines: [
    { name: 'Organic Bananas - 2lb', qty: 1, total: 1.79 },
    { name: 'Chobani strawberry yogurt – 32oz', qty: 2, total: 11.98 },
  ],
};

describe('receipt links', () => {
  it('round-trips receipts, including non-ASCII names', () => {
    const link = encodeReceiptsLink('https://fridgeboard-642b9.web.app', [sample]);
    expect(link.startsWith('https://fridgeboard-642b9.web.app/#receipts=')).toBe(true);
    const drafts = decodeReceiptsHash(link.slice(link.indexOf('#')), 'u1')!;
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      store: 'target',
      purchasedAt: dateToMs('2026-11-08'),
      paidBy: 'u1',
      totalCents: 16260,
    });
    expect(drafts[0].lines[1]).toMatchObject({
      name: 'Chobani strawberry yogurt – 32oz',
      qty: 2,
      cents: 1198,
    });
  });

  it('rejects junk', () => {
    expect(decodeReceiptsHash('#receipts=!!!', 'u1')).toBeNull();
    expect(decodeReceiptsHash('#import=abc', 'u1')).toBeNull();
    const notArray = encodeReceiptsLink('x', { a: 1 } as unknown as unknown[]);
    expect(decodeReceiptsHash(notArray.slice(notArray.indexOf('#')), 'u1')).toBeNull();
  });

  it('spots a receipt that is already saved', () => {
    const [draft] = decodeReceiptsHash(
      encodeReceiptsLink('x', [sample]).replace(/^x\//, ''),
      'u1',
    )!;
    const saved = { ...draft, id: 'r1', createdBy: 'u1', createdAt: 0 } as Receipt;
    expect(isDuplicate(draft, [saved])).toBe(true);
    expect(isDuplicate({ ...draft, totalCents: 100 }, [saved])).toBe(false);
    expect(isDuplicate({ ...draft, store: 'ht' }, [saved])).toBe(false);
  });
});
