export type StoreId = 'ht' | 'target' | 'amazon';
export type ListId = 'grocery' | 'nice';
export type ItemStatus = 'open' | 'checked';
export type PriceKind = 'vic' | 'regular' | 'paid' | 'manual';
export type AisleSource = 'kroger' | 'learned' | 'manual';

export interface StorePrice {
  /** Price for one unit, in cents. */
  cents: number;
  kind: PriceKind;
  at: number; // epoch ms
}

export interface StoreAisle {
  label: string;
  source: AisleSource;
}

export interface StoreInfo {
  aisle?: StoreAisle;
  price?: StorePrice;
}

export interface Item {
  id: string;
  name: string;
  normalizedName: string;
  list: ListId;
  qty: number;
  unit: string;
  note: string;
  /** Stores this item can be bought at. The first entry is its main store. */
  stores: StoreId[];
  storeInfo: Partial<Record<StoreId, StoreInfo>>;
  status: ItemStatus;
  createdBy: string;
  createdAt: number;
  updatedBy: string;
  updatedAt: number;
  checkedBy?: string;
}

export type ActivityType =
  'add' | 'edit' | 'check' | 'uncheck' | 'move' | 'delete' | 'trip_start' | 'trip_end';

export interface ActivityEvent {
  id: string;
  actorId: string;
  type: ActivityType;
  itemIds: string[];
  itemNames: string[];
  batchId: string;
  store?: StoreId;
  detail?: string;
  at: number;
}

export interface Member {
  name: string;
  color: string;
  photoURL?: string;
}

export interface Household {
  id: string;
  name: string;
  memberIds: string[];
  members: Record<string, Member>;
  inviteCode: string;
  zip: string;
  zoneOrder: Partial<Record<StoreId, string[]>>;
}

export type TripMode = 'together' | 'solo';

export interface Trip {
  id: string;
  store: StoreId;
  mode: TripMode;
  startedBy: string;
  participants: string[];
  status: 'active' | 'ended';
  startedAt: number;
}

export interface UserProfile {
  householdId: string | null;
}
