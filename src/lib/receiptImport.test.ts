import { describe, expect, it } from 'vitest';
import {
  decodeReceiptsHash,
  encodeReceiptsLink,
  findSaved,
  isDuplicate,
  memberByName,
  receiptPatch,
} from './receiptImport';
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

describe('payers in receipt links', () => {
  const members = {
    j: { name: 'Jazz H', color: '#89CFF0' },
    m: { name: 'Madison', color: '#98E5C8' },
  };

  it('matches a first name, ignoring case', () => {
    expect(memberByName('madison', members)).toBe('m');
    expect(memberByName('Jazz', members)).toBe('j');
    expect(memberByName('Sam', members)).toBeNull();
  });

  it('sets paidBy from the link and remembers it was given', () => {
    const link = encodeReceiptsLink('x', [
      { ...sample, payer: 'Madison' },
      { ...sample, date: '2026-11-09', payer: 'Nobody' },
    ]);
    const [a, b] = decodeReceiptsHash(link.slice(link.indexOf('#')), 'j', members)!;
    expect(a).toMatchObject({ paidBy: 'm', linkPayer: 'm' });
    expect(b.paidBy).toBe('j');
    expect(b.linkPayer).toBeUndefined();
  });
});

describe('payments in receipt links', () => {
  it('reads payments and tips, and patches saved receipts', () => {
    const link = encodeReceiptsLink('x', [
      {
        ...sample,
        payments: [
          { card: 'Target Mastercard', last4: '*8759', amount: 100 },
          { card: 'Target Circle Credit Card', last4: '3979', amount: 62.6 },
        ],
      },
      { store: 'target', date: '2026-11-08', total: 5, kind: 'tip' },
    ]);
    const [buy, tip] = decodeReceiptsHash(link.slice(link.indexOf('#')), 'u1')!;
    expect(buy.payments).toEqual([
      { card: 'Target Mastercard', last4: '8759', cents: 10000 },
      { card: 'Target Circle Credit Card', last4: '3979', cents: 6260 },
    ]);
    expect(tip.kind).toBe('tip');

    const saved = {
      ...buy,
      payments: undefined,
      id: 'r1',
      createdBy: 'u1',
      createdAt: 0,
    } as Receipt;
    // A tip never matches a purchase on the same day.
    expect(findSaved(tip, [saved])).toBeUndefined();
    expect(findSaved(buy, [saved])).toBe(saved);
    expect(receiptPatch(buy, saved)).toEqual({ payments: buy.payments });
    expect(receiptPatch(buy, { ...saved, payments: buy.payments })).toBeNull();
  });
});
