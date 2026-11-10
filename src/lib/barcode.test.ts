import { describe, expect, it } from 'vitest';
import { isProductCode, nameFromOff, normalizeCode } from './barcode';

describe('barcodes', () => {
  it('accepts product codes and normalizes UPC-A to EAN-13', () => {
    expect(isProductCode('012345678905')).toBe(true);
    expect(isProductCode('https://example.com')).toBe(false);
    expect(normalizeCode('012345678905')).toBe('0012345678905');
    expect(normalizeCode('5000112637922')).toBe('5000112637922');
  });

  it('builds a short name from Open Food Facts data', () => {
    expect(
      nameFromOff({
        product_name: 'Strawberry Greek Yogurt',
        brands: 'Chobani,Chobani Inc',
        quantity: '32 oz',
      }),
    ).toBe('Chobani Strawberry Greek Yogurt 32 oz');
    expect(nameFromOff({ product_name: 'Chobani Flip', brands: 'Chobani' })).toBe('Chobani Flip');
    expect(nameFromOff({ brands: 'X' })).toBeNull();
    expect(nameFromOff(null)).toBeNull();
  });
});
