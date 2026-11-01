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
  | 'add'
  | 'edit'
  | 'check'
  | 'uncheck'
  | 'move'
  | 'delete'
  | 'trip_start'
  | 'trip_join'
  | 'trip_end'
  | 'receipt';

/** Stores a receipt can come from. "other" covers anywhere not on the list (Costco, a farmers market). */
export type ReceiptStore = StoreId | 'other';

export interface ReceiptLine {
  /** Text as printed, e.g. "HT ORG SPINACH 10Z". */
  raw: string;
  /** Readable name, e.g. "Organic spinach". */
  name: string;
  qty: number;
  /** What the line cost in total, after its own discounts. */
  cents: number;
  /** The list item this line matched, if any. */
  itemId: string | null;
}

export interface Receipt {
  id: string;
  store: ReceiptStore;
  /** Purchase date, epoch ms at local noon. */
  purchasedAt: number;
  paidBy: string;
  createdBy: string;
  createdAt: number;
  subtotalCents: number;
  taxCents: number;
  savingsCents: number;
  totalCents: number;
  lines: ReceiptLine[];
}

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
  /** Monthly grocery budget in cents, or null when none is set. */
  budgetCents: number | null;
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
