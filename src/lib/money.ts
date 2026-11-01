import type { Item, StoreId } from '../types';
import { itemsInView, viewStore } from './aisles';

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** "3.99", "$3.99", " 4 " → cents. Empty or invalid → null. */
export function parsePrice(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!cleaned || !/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Price for the whole line (unit price × quantity) at a store, or null when unknown. */
export function lineCents(item: Item, store: StoreId): number | null {
  const unit = item.storeInfo[store]?.price?.cents;
  return unit == null ? null : unit * Math.max(1, item.qty || 1);
}

export interface Estimate {
  cents: number;
  open: number;
  missing: number;
}

/** Estimated total for open items in the current view. */
export function estimate(items: Item[], store: StoreId | 'all'): Estimate {
  const open = itemsInView(items, store).filter((i) => i.status === 'open');
  let cents = 0;
  let missing = 0;
  for (const item of open) {
    const line = lineCents(item, viewStore(item, store));
    if (line == null) missing += 1;
    else cents += line;
  }
  return { cents, open: open.length, missing };
}
