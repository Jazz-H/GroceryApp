/**
 * Package sizes and unit prices: "64 oz", "1 gal", "12 ct", "2 lb", "500 ml".
 * Weights compare per ounce, liquids per fluid ounce, counts per item. A plain "oz" is
 * how US labels write both, so it compares with weights and liquids alike.
 */

export type SizeFamily = 'weight' | 'volume' | 'count';

export interface Size {
  amount: number;
  /** As typed, tidied: "oz", "fl oz", "lb", "ct"… */
  unit: string;
  family: SizeFamily;
  /** Amount in the family's base unit: oz, fl oz, or items. */
  base: number;
  /** True for a bare "oz", which matches weight or volume. */
  ozAmbiguous: boolean;
}

const UNITS: Record<string, { unit: string; family: SizeFamily; per: number }> = {
  oz: { unit: 'oz', family: 'weight', per: 1 },
  ounce: { unit: 'oz', family: 'weight', per: 1 },
  lb: { unit: 'lb', family: 'weight', per: 16 },
  lbs: { unit: 'lb', family: 'weight', per: 16 },
  pound: { unit: 'lb', family: 'weight', per: 16 },
  g: { unit: 'g', family: 'weight', per: 1 / 28.3495 },
  gram: { unit: 'g', family: 'weight', per: 1 / 28.3495 },
  kg: { unit: 'kg', family: 'weight', per: 35.274 },
  'fl oz': { unit: 'fl oz', family: 'volume', per: 1 },
  floz: { unit: 'fl oz', family: 'volume', per: 1 },
  ml: { unit: 'ml', family: 'volume', per: 1 / 29.5735 },
  l: { unit: 'L', family: 'volume', per: 33.814 },
  liter: { unit: 'L', family: 'volume', per: 33.814 },
  litre: { unit: 'L', family: 'volume', per: 33.814 },
  gal: { unit: 'gal', family: 'volume', per: 128 },
  gallon: { unit: 'gal', family: 'volume', per: 128 },
  qt: { unit: 'qt', family: 'volume', per: 32 },
  quart: { unit: 'qt', family: 'volume', per: 32 },
  pt: { unit: 'pt', family: 'volume', per: 16 },
  pint: { unit: 'pt', family: 'volume', per: 16 },
  ct: { unit: 'ct', family: 'count', per: 1 },
  count: { unit: 'ct', family: 'count', per: 1 },
  pk: { unit: 'ct', family: 'count', per: 1 },
  pack: { unit: 'ct', family: 'count', per: 1 },
  each: { unit: 'ct', family: 'count', per: 1 },
  ea: { unit: 'ct', family: 'count', per: 1 },
  roll: { unit: 'ct', family: 'count', per: 1 },
  rolls: { unit: 'ct', family: 'count', per: 1 },
};

/** Reads "64 oz", "1.5 lb", "12-ct", "2 x 6 pk" (= 12 ct), "½ gal". Null if it isn't a size. */
export function parseSize(input: string | undefined): Size | null {
  const text = (input ?? '')
    .toLowerCase()
    .replace(/½/g, '.5')
    .replace(/¼/g, '.25')
    .replace(/(\d)-(?=[a-z])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  const m = /^(?:(\d+(?:\.\d+)?)\s*[x×]\s*)?(\d*\.?\d+)\s*(fl\.?\s*oz|[a-z]+)\.?$/.exec(text);
  if (!m) return null;
  const key = m[3].replace(/\./g, '').replace(/\s+/g, ' ').replace(/s$/, '');
  const def = UNITS[m[3].replace(/\./g, '')] ?? UNITS[key] ?? UNITS[key.replace(' ', '')];
  if (!def) return null;
  const amount = Number(m[2]) * (m[1] ? Number(m[1]) : 1);
  if (!(amount > 0) || amount > 100_000) return null;
  return {
    amount,
    unit: def.unit,
    family: def.family,
    base: amount * def.per,
    ozAmbiguous: def.unit === 'oz',
  };
}

/** "64 oz", "1 gal", "12 ct": a size written back tidily. */
export function formatSize(size: Size): string {
  const n = Number.isInteger(size.amount) ? String(size.amount) : String(+size.amount.toFixed(2));
  return `${n} ${size.unit}`;
}

function baseLabel(family: SizeFamily, ozAmbiguous: boolean): string {
  if (family === 'count') return 'each';
  return family === 'volume' && !ozAmbiguous ? 'fl oz' : 'oz';
}

export interface UnitPrice {
  /** Cents per oz / fl oz / item (can be fractional). */
  centsPer: number;
  /** "oz", "fl oz" or "each". */
  per: string;
  family: SizeFamily;
  ozAmbiguous: boolean;
}

export function unitPrice(cents: number | undefined, size: Size | null): UnitPrice | null {
  if (cents == null || !size || cents <= 0) return null;
  return {
    centsPer: cents / size.base,
    per: baseLabel(size.family, size.ozAmbiguous),
    family: size.family,
    ozAmbiguous: size.ozAmbiguous,
  };
}

/** "$0.06/oz", "$0.42 each"; sub-cent prices get a third decimal ("$0.004/fl oz"). */
export function formatUnitPrice(u: UnitPrice): string {
  const dollars = u.centsPer / 100;
  const digits = dollars < 0.1 ? 3 : 2;
  const amount = `$${dollars.toFixed(digits)}`;
  return u.per === 'each' ? `${amount} each` : `${amount}/${u.per}`;
}

/** Whether two unit prices measure the same thing (a plain "oz" matches weight or volume). */
export function comparable(a: UnitPrice, b: UnitPrice): boolean {
  if (a.family === b.family) return true;
  const oz = (u: UnitPrice) => u.family !== 'count';
  return oz(a) && oz(b) && (a.ozAmbiguous || b.ozAmbiguous);
}

/**
 * The cheapest store per unit, when at least two stores can be compared:
 * { store, pctCheaper } against the next best. Null otherwise.
 */
export function cheapestPerUnit<S extends string>(
  prices: { store: S; unit: UnitPrice }[],
): { store: S; runnerUp: S; pctCheaper: number } | null {
  let best: { store: S; runnerUp: S; pctCheaper: number } | null = null;
  for (const a of prices) {
    const rivals = prices.filter((b) => b !== a && comparable(a.unit, b.unit));
    if (!rivals.length) continue;
    const next = rivals.reduce((m, b) => (b.unit.centsPer < m.unit.centsPer ? b : m));
    if (a.unit.centsPer >= next.unit.centsPer) continue;
    const pct = Math.round((1 - a.unit.centsPer / next.unit.centsPer) * 100);
    if (!best || pct > best.pctCheaper)
      best = { store: a.store, runnerUp: next.store, pctCheaper: pct };
  }
  return best && best.pctCheaper >= 1 ? best : null;
}
