export type StoreId = 'ht' | 'target' | 'amazon';
/** 'grocery', 'nice', or a custom list's id ('l_' + letters/digits, see lib/lists). */
export type ListId = 'grocery' | 'nice' | `l_${string}`;

/** A list the household made, e.g. Costco or Party. */
export interface ListDef {
  id: ListId;
  name: string;
}
/** "ordered": in a placed pickup order (Target), waiting to be picked up. */
export type ItemStatus = 'open' | 'checked' | 'ordered';
export type PriceKind = 'vic' | 'regular' | 'paid' | 'manual';
export type AisleSource = 'kroger' | 'learned' | 'manual';
export type CategoryId =
  | 'produce'
  | 'meat'
  | 'dairy'
  | 'bakery'
  | 'deli'
  | 'frozen'
  | 'pantry'
  | 'snacks'
  | 'drinks'
  | 'household'
  | 'personal'
  | 'baby'
  | 'pet'
  | 'other';

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
  /** Package size as written, e.g. "64 oz" or "12 ct" (see lib/units). */
  size?: string;
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
  /** Set by you. When unset, the category is guessed from the name (see lib/categories). */
  category?: CategoryId;
  /** What to get instead if it's out, e.g. "almond milk". */
  substitute?: string;
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
  | 'receipt'
  | 'order'
  | 'pickup';

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
  /** Normalized name of the matched item, so price history survives clearing the item. */
  itemKey?: string | null;
}

/** Everything the household has ever added, kept after items are cleared. Powers "usuals". */
export interface CatalogEntry {
  key: string;
  name: string;
  count: number;
  /** Recent add times (epoch ms), oldest first, at most 6. */
  addedAt: number[];
  stores: StoreId[];
  storeInfo: Partial<Record<StoreId, StoreInfo>>;
  /** The category you last set for this name; used for new items and receipt lines. */
  category?: CategoryId;
}

/** One way a receipt was paid, e.g. "Target Mastercard" *8759 for $19.50. */
export interface ReceiptPayment {
  card: string;
  /** Last 4 digits, or "" for coupons and other non-card payments. */
  last4: string;
  cents: number;
}

export interface Receipt {
  id: string;
  /** "tip" for a shopper tip paid after a delivery; purchases leave it unset. */
  kind?: 'tip';
  /** How it was paid, when known. Amounts add up to the total. */
  payments?: ReceiptPayment[];
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

/** One member paying another back, so shared spending evens out. */
export interface Settlement {
  id: string;
  /** Who paid the money back. */
  from: string;
  /** Who received it. */
  to: string;
  cents: number;
  by: string;
  at: number;
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
  /** The month ("2026-10") whose recap has been sent, so it goes out once. */
  recapSentFor?: string;
  /** The week (its Monday, "2026-11-02") whose weekly recap has been sent. */
  weekRecapSentFor?: string;
  /** Lists the household made, after Grocery and Nice-to-have. */
  lists?: ListDef[];
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

export interface RecipeIngredient {
  name: string;
  qty: number;
  /** Most kitchens already have it (salt, oil…), so it starts unticked when shopping. */
  staple: boolean;
}

/** A saved recipe in the recipe box. */
export interface Recipe {
  id: string;
  title: string;
  /** Where it came from: a link, or '' for pasted text and photos. */
  source: string;
  ingredients: RecipeIngredient[];
  createdBy: string;
  createdAt: number;
}

/** One planned meal on one day: a saved recipe, or just a note like "Leftovers". */
export interface Meal {
  id: string;
  /** "2026-11-16" */
  date: string;
  title: string;
  recipeId: string | null;
  by: string;
  createdAt: number;
}
