import type { Item, StoreId, StoreInfo } from '../types';

let n = 0;
/** Builds an Item for tests with sensible defaults. */
export function makeItem(
  name: string,
  stores: StoreId[],
  info: Partial<Record<StoreId, StoreInfo>> = {},
  extra: Partial<Item> = {},
): Item {
  n += 1;
  return {
    id: `i${n}`,
    name,
    normalizedName: name.toLowerCase(),
    list: 'grocery',
    qty: 1,
    unit: '',
    note: '',
    stores,
    storeInfo: info,
    status: 'open',
    createdBy: 'u1',
    createdAt: n,
    updatedBy: 'u1',
    updatedAt: n,
    ...extra,
  };
}

export const aisle = (label: string): StoreInfo['aisle'] => ({ label, source: 'manual' });
export const price = (cents: number): StoreInfo['price'] => ({ cents, kind: 'manual', at: 0 });
