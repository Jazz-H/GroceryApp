import { normalizeName, parseQuickAdd, type QuickAdd } from './text';

/** Most items one spoken phrase can add. */
export const MAX_SPOKEN_ITEMS = 10;

/** Item names that contain "and" and must not be split. */
const KEEP_TOGETHER = [
  'mac and cheese',
  'macaroni and cheese',
  'half and half',
  'salt and pepper',
  'peanut butter and jelly',
  'pb and j',
  'oil and vinegar',
  'chips and salsa',
  'sour cream and onion',
  'rice and beans',
  'pork and beans',
  'hot and sour',
  'sweet and sour',
  'salt and vinegar',
  'cookies and cream',
  'peaches and cream',
];

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  dozen: 12,
};

/**
 * Turns a spoken phrase into items: "Add milk, two avocados and mac and cheese to the list"
 * → Milk, 2 × Avocados, Mac and cheese. Commas, "and", "also" and "plus" separate items.
 */
export function parseSpoken(input: string): QuickAdd[] {
  let text = ` ${input.replace(/\s+/g, ' ').trim()} `;
  // "Add …", "Please add …", "… to the list", "… to Stocked".
  text = text
    .replace(/^\s*(?:hey\s+siri,?\s*)?(?:please\s+)?(?:add|put|get)\s+/i, ' ')
    .replace(
      /\s+(?:to|on)\s+(?:the|my|our)?\s*(?:grocery\s+|shopping\s+)?(?:list|stocked)\s*[.!]?\s*$/i,
      ' ',
    )
    .replace(/[.!?]+\s*$/, ' ');
  // Protect names with "and" in them, then split on the spoken separators.
  const kept: string[] = [];
  for (const phrase of KEEP_TOGETHER) {
    text = text.replace(new RegExp(`\\b${phrase.replace(/ /g, '\\s+')}\\b`, 'gi'), (m) => {
      kept.push(m);
      return `${kept.length - 1}`;
    });
  }
  text = text.replace(/\s*(?:,|;|\band\b|\balso\b|\bplus\b|\bthen\b)\s*/gi, ',');
  text = text.replace(/(\d+)/g, (_, i) => kept[Number(i)]);
  // "two avocados" → "2 avocados", "a dozen eggs" → "12 eggs".
  text = text
    .split(',')
    .map((part) => {
      const p = part.trim().replace(/^a\s+dozen\s+/i, 'dozen ');
      const m = /^([a-z]+)\s+(.+)$/i.exec(p);
      const n = m ? WORD_NUMBERS[m[1].toLowerCase()] : undefined;
      return n && m ? `${n} ${m[2]}` : p;
    })
    .join(',');
  const seen = new Set<string>();
  return parseQuickAdd(text)
    .filter((q) => {
      const key = normalizeName(q.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SPOKEN_ITEMS);
}

/** What Siri says back: "Added milk and eggs." / "Milk is already on the list." */
export function spokenReply(added: string[], skipped: string[]): string {
  const list = (names: string[]) =>
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const lower = (names: string[]) => names.map((n) => n.toLowerCase());
  const parts: string[] = [];
  if (added.length) parts.push(`Added ${list(lower(added))}.`);
  if (skipped.length)
    parts.push(
      `${list(skipped)} ${skipped.length === 1 ? 'is' : 'are'} already on the list.`.replace(
        /^./,
        (c) => c.toUpperCase(),
      ),
    );
  return parts.join(' ') || 'I didn’t catch any items.';
}
