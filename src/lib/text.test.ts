import { describe, expect, it } from 'vitest';
import { cleanInviteCode, makeInviteCode, normalizeName, parseQuickAdd } from './text';

describe('parseQuickAdd', () => {
  it('splits on commas and new lines', () => {
    expect(parseQuickAdd('eggs, milk\nbread')).toEqual([
      { name: 'Eggs', qty: 1 },
      { name: 'Milk', qty: 1 },
      { name: 'Bread', qty: 1 },
    ]);
  });
  it('reads leading and trailing quantities', () => {
    expect(parseQuickAdd('2 frozen pizza, bananas x6, 3x limes')).toEqual([
      { name: 'Frozen pizza', qty: 2 },
      { name: 'Bananas', qty: 6 },
      { name: 'Limes', qty: 3 },
    ]);
  });
  it('leaves numbers inside names alone', () => {
    expect(parseQuickAdd('7up')).toEqual([{ name: '7up', qty: 1 }]);
    expect(parseQuickAdd('AA batteries')).toEqual([{ name: 'AA batteries', qty: 1 }]);
  });
  it('ignores empty parts', () => {
    expect(parseQuickAdd(' , ,')).toEqual([]);
  });
});

describe('normalizeName', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(normalizeName('  Oat-Milk ')).toBe(normalizeName('oat milk'));
  });
});

describe('invite codes', () => {
  it('makes six readable characters', () => {
    const code = makeInviteCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
  it('cleans typed codes', () => {
    expect(cleanInviteCode('ab3-k9q ')).toBe('AB3K9Q');
  });
});
