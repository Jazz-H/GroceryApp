import type { StoreId } from '../types';

export interface StoreDef {
  id: StoreId;
  name: string;
  short: string;
  /** Whether aisles make sense for this store (Amazon has none). */
  hasAisles: boolean;
  /** Label for the kind of price that store's loyalty program gives. */
  memberPriceLabel?: string;
}

export const STORES: StoreDef[] = [
  { id: 'ht', name: 'Harris Teeter', short: 'HT', hasAisles: true, memberPriceLabel: 'VIC' },
  { id: 'target', name: 'Target', short: 'TGT', hasAisles: true, memberPriceLabel: 'Circle' },
  { id: 'amazon', name: 'Amazon', short: 'AMZ', hasAisles: false },
];

export const STORE_IDS = STORES.map((s) => s.id);

export function storeDef(id: StoreId): StoreDef {
  const def = STORES.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown store: ${id}`);
  return def;
}

export function isStoreId(value: unknown): value is StoreId {
  return typeof value === 'string' && (STORE_IDS as string[]).includes(value);
}

/** The token in a zone order that stands for all numbered aisles. */
export const AISLES_TOKEN = 'Aisles';

/** Starting walking order for named zones. Editable per household in Settings. */
export const DEFAULT_ZONE_ORDER: Partial<Record<StoreId, string[]>> = {
  ht: ['Produce', 'Bakery', 'Deli', AISLES_TOKEN, 'Meat & Seafood', 'Frozen', 'Dairy'],
  target: [AISLES_TOKEN],
};

/**
 * Marker colors. The household creator gets the first, the next person to join gets the second.
 * Pastels are shown as-is in dark mode and as a deeper ink of the same hue on the white board.
 */
export const MEMBER_COLORS = [
  { hex: '#89cff0', name: 'Baby blue' },
  { hex: '#98e5c8', name: 'Mint green' },
  { hex: '#0f8a7e', name: 'Teal' },
  { hex: '#e2617f', name: 'Rose' },
  { hex: '#a98bef', name: 'Lavender' },
  { hex: '#f0a04b', name: 'Tangerine' },
];
