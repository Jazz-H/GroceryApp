/** Lowercase, no punctuation, single spaces. Used to catch duplicates like "Eggs" vs "eggs ". */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface QuickAdd {
  name: string;
  qty: number;
  /** Optional extras, used by Import. */
  store?: import('../types').StoreId;
  priceCents?: number;
  priceKind?: import('../types').PriceKind;
  note?: string;
}

/**
 * Parses the add box. Commas or new lines separate items, so "eggs, 2 milk, bread x3"
 * adds three items in one go (and logs as one grouped entry).
 */
export function parseQuickAdd(input: string): QuickAdd[] {
  return input
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      let qty = 1;
      let name = part;
      const lead = /^(\d{1,3})\s*(?:x|×)?\s+(.+)$/i.exec(part);
      const trail = /^(.+?)\s*(?:x|×)\s*(\d{1,3})$/i.exec(part);
      if (lead) {
        qty = Number(lead[1]);
        name = lead[2];
      } else if (trail) {
        name = trail[1];
        qty = Number(trail[2]);
      }
      name = name.trim();
      return { name: name.charAt(0).toUpperCase() + name.slice(1), qty: Math.max(1, qty) };
    })
    .filter((q) => q.name.length > 0);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I

/** Six-character invite code that's easy to read aloud. */
export function makeInviteCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return code;
}

export function cleanInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
