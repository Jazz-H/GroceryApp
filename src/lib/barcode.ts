/** Barcode helpers that don't touch the network or the camera (easy to test). */

/** UPC-A, UPC-E, EAN-8 and EAN-13 are digits only, 8 to 14 long. */
export function isProductCode(raw: string): boolean {
  return /^\d{8,14}$/.test(raw.trim());
}

/** UPC-A and EAN-13 name the same product ("0" + UPC-A = EAN-13), so store one form. */
export function normalizeCode(raw: string): string {
  const d = raw.trim();
  return d.length === 12 ? `0${d}` : d;
}

interface OffProduct {
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  brands?: string;
  quantity?: string;
}

/** A short list-friendly name from an Open Food Facts product: "Chobani Strawberry Yogurt 32 oz". */
export function nameFromOff(p: OffProduct | null | undefined): string | null {
  if (!p) return null;
  const product = (p.product_name_en || p.product_name || p.generic_name || '').trim();
  if (!product) return null;
  const brand = (p.brands ?? '').split(',')[0].trim();
  const withBrand =
    brand && !product.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${product}` : product;
  const qty = (p.quantity ?? '').trim();
  const full = qty && !withBrand.includes(qty) ? `${withBrand} ${qty}` : withBrand;
  return full.replace(/\s+/g, ' ').slice(0, 80);
}
