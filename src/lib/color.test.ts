import { describe, expect, it } from 'vitest';
import { contrast, inkFor, textOn } from './color';
import { MEMBER_COLORS } from './stores';

describe('marker colors', () => {
  it('starts with baby blue and mint green', () => {
    expect(MEMBER_COLORS[0].name).toBe('Baby blue');
    expect(MEMBER_COLORS[1].name).toBe('Mint green');
  });

  it('gives every color a readable ink on the white board', () => {
    for (const c of MEMBER_COLORS)
      expect(contrast(inkFor(c.hex), '#ffffff')).toBeGreaterThanOrEqual(3);
  });

  it('keeps every raw color readable on the dark board', () => {
    for (const c of MEMBER_COLORS) expect(contrast(c.hex, '#172129')).toBeGreaterThanOrEqual(3);
  });

  it('leaves dark colors alone and keeps pastel hues blue and green', () => {
    expect(inkFor('#0f8a7e')).toBe('#0f8a7e');
    const blue = inkFor('#89cff0');
    const mint = inkFor('#98e5c8');
    const [, , bb] = [1, 3, 5].map((i) => parseInt(blue.slice(i, i + 2), 16));
    const [, mg] = [1, 3, 5].map((i) => parseInt(mint.slice(i, i + 2), 16));
    expect(bb).toBeGreaterThan(parseInt(blue.slice(1, 3), 16)); // still blue-dominant
    expect(mg).toBeGreaterThan(parseInt(mint.slice(1, 3), 16)); // still green-dominant
  });

  it('puts dark text on pastel avatars and white on dark ones', () => {
    expect(textOn('#89cff0')).toBe('#12304f');
    expect(textOn('#0f8a7e')).toBe('#ffffff');
  });
});
