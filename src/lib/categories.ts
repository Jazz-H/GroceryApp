import { normalizeName } from './text';
import { catalogKey } from './usuals';
import type { CatalogEntry, CategoryId, Item, Receipt } from '../types';

export interface CategoryDef {
  id: CategoryId;
  name: string;
  /** The store zone (in a zone order) this category is shelved in, if it has one. */
  zone?: string;
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'produce', name: 'Produce', zone: 'Produce' },
  { id: 'meat', name: 'Meat & seafood', zone: 'Meat & Seafood' },
  { id: 'dairy', name: 'Dairy & eggs', zone: 'Dairy' },
  { id: 'bakery', name: 'Bakery & bread', zone: 'Bakery' },
  { id: 'deli', name: 'Deli', zone: 'Deli' },
  { id: 'frozen', name: 'Frozen', zone: 'Frozen' },
  { id: 'pantry', name: 'Pantry' },
  { id: 'snacks', name: 'Snacks & sweets' },
  { id: 'drinks', name: 'Drinks' },
  { id: 'household', name: 'Household' },
  { id: 'personal', name: 'Personal care' },
  { id: 'baby', name: 'Baby' },
  { id: 'pet', name: 'Pet' },
  { id: 'other', name: 'Other' },
];

const IDS = new Set<string>(CATEGORIES.map((c) => c.id));

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && IDS.has(value);
}

export function categoryName(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)?.name ?? 'Other';
}

/**
 * Keyword rules, checked in order: the first category with a matching word or phrase wins.
 * Order matters: "frozen peas" is Frozen, "chicken broth" is Pantry, "dog food" is Pet.
 * Words match whole words, with a trailing "s"/"es" allowed ("apple" matches "apples").
 * Ambiguous single words are avoided: "baby spinach" is produce, "pad thai" isn't personal care.
 */
const RULES: [CategoryId, string][] = [
  // Phrases whose words would otherwise land in the wrong place ("beans" is Pantry).
  ['drinks', 'coffee beans, ground coffee, coffee pods, k cups'],
  [
    'pet',
    'dog, dog food, cat food, cat litter, litter, kibble, pet food, puppy, kitten, dog treats',
  ],
  [
    'personal',
    'shampoo, conditioner, toothpaste, toothbrush, floss, mouthwash, deodorant, body wash, soap bar, lotion, razor, shaving, sunscreen, tampon, maxi pad, vitamin, ibuprofen, tylenol, advil, allergy, bandaid, band aid, makeup, cotton swab, q tip, chapstick, lip balm, hair, contact solution',
  ],
  [
    'household',
    'paper towel, toilet paper, tissue, napkin, trash bag, garbage bag, foil, plastic wrap, ziploc, zip bag, sandwich bag, detergent, dish soap, dishwasher, bleach, cleaner, sponge, clorox, lysol, windex, dryer sheet, fabric softener, light bulb, battery, batteries, candle, hand soap, parchment, swiffer, paper plates, plastic cups, utensils, charcoal, disinfecting wipes',
  ],
  [
    'baby',
    'diaper, baby food, baby formula, formula, baby wipes, wipes, pull ups, infant, pacifier, teether',
  ],
  ['frozen', 'frozen, ice cream, popsicle, gelato, sorbet, ice, waffles, pizza rolls, tater tots'],
  [
    'pantry',
    'broth, stock, soup, sauce, canned, can of, peanut butter, almond butter, jelly, jam, honey, syrup, pasta, spaghetti, penne, noodle, ramen, rice, quinoa, oats, oatmeal, cereal, granola, flour, sugar, baking, yeast, oil, olive oil, vinegar, salt, black pepper, peppercorn, pepper flakes, spice, seasoning, cumin, paprika, cinnamon, oregano, vanilla, ketchup, mustard, mayo, mayonnaise, relish, salsa, dressing, beans, chickpeas, lentils, tuna, coconut milk, tomato paste, diced tomatoes, crushed tomatoes, marinara, pesto, soy sauce, sriracha, hot sauce, bbq, nuts, almonds, walnuts, pecans, cashews, raisins, mac and cheese, taco shells, breadcrumbs, bread crumbs, cornstarch, baking soda, baking powder',
  ],
  [
    'drinks',
    'water, sparkling, seltzer, la croix, soda, coke, pepsi, sprite, juice, lemonade, coffee, tea, kombucha, beer, wine, gatorade, energy drink, red bull, drink, cold brew',
  ],
  [
    'snacks',
    'chips, crackers, pretzels, popcorn, cookie, candy, chocolate, gummies, snack, bar, granola bar, protein bar, trail mix, goldfish, oreo, doritos, cheez it, pop tarts, fruit snacks, jerky',
  ],
  [
    'bakery',
    'bread, bagel, bun, roll, tortilla, pita, naan, croissant, muffin, english muffin, baguette, sourdough, cake, donut, brioche',
  ],
  [
    'deli',
    'deli, sliced turkey, turkey breast, salami, prosciutto, pepperoni, hummus, rotisserie, lunch meat, sliced ham',
  ],
  [
    'dairy',
    'milk, oat milk, almond milk, cheese, cheddar, mozzarella, parmesan, feta, yogurt, greek yogurt, butter, cream, half and half, sour cream, cream cheese, cottage cheese, egg, creamer, kefir, ricotta',
  ],
  [
    'meat',
    'chicken, beef, steak, ground beef, ground turkey, turkey, pork, bacon, sausage, ham, lamb, salmon, shrimp, fish, cod, tilapia, tuna steak, scallops, crab, hot dog, brisket, ribs, meatballs, chorizo',
  ],
  [
    'produce',
    'apple, banana, orange, lemon, lime, grape, strawberry, strawberries, blueberry, blueberries, raspberry, raspberries, berries, avocado, tomato, tomatoes, potato, potatoes, sweet potato, onion, garlic, ginger, carrot, celery, cucumber, pepper, bell pepper, jalapeno, lettuce, spinach, kale, arugula, romaine, salad, broccoli, cauliflower, zucchini, squash, mushroom, corn, green beans, asparagus, cilantro, parsley, basil, mint, herbs, peach, pear, plum, mango, pineapple, melon, watermelon, cantaloupe, kiwi, cherries, scallion, green onion, shallot, cabbage, brussels sprouts, beet, radish, fruit, veggie, vegetable, clementine, cuties',
  ],
];

const COMPILED: [CategoryId, RegExp][] = RULES.map(([id, words]) => [
  id,
  new RegExp(
    `(?:^| )(?:${words
      .split(', ')
      .map((w) => normalizeName(w).replace(/ /g, ' ?'))
      .sort((a, b) => b.length - a.length)
      .join('|')})(?:e?s)?(?= |$)`,
  ),
]);

/** A best guess from the name alone, e.g. "Organic baby spinach" → produce. */
export function guessCategory(name: string): CategoryId {
  const n = normalizeName(name);
  if (!n) return 'other';
  for (const [id, re] of COMPILED) if (re.test(n)) return id;
  return 'other';
}

/** Categories you've set yourself, by catalog key. */
export function learnedCategories(catalog: Pick<CatalogEntry, 'key' | 'category'>[]) {
  const map = new Map<string, CategoryId>();
  for (const c of catalog) if (c.category) map.set(c.key, c.category);
  return map;
}

/** The category an item shows: one set on it, else one you set before for that name, else a guess. */
export function categoryOf(
  item: Pick<Item, 'name' | 'category'>,
  learned?: Map<string, CategoryId>,
): CategoryId {
  return item.category ?? learned?.get(catalogKey(item.name)) ?? guessCategory(item.name);
}

/** The zone an item without an aisle goes in: its category's zone, if the store has that zone. */
export function zoneForCategory(category: CategoryId, zoneOrder: string[]): string | undefined {
  const zone = CATEGORIES.find((c) => c.id === category)?.zone;
  if (!zone) return undefined;
  return zoneOrder.find((z) => z.toLowerCase() === zone.toLowerCase());
}

export interface CategoryLine {
  /** Name to show, and to remember a category under. */
  name: string;
  cents: number;
  /** How many receipt lines had this name. */
  count: number;
}

export interface CategorySlice {
  key: CategoryId;
  cents: number;
  /** Biggest spend first. */
  lines: CategoryLine[];
}

export interface CategorySpend {
  slices: CategorySlice[];
  /** Tax, fees and discounts: the gap between itemized receipts' totals and their item lines. */
  otherCents: number;
  /** Receipts saved with a total but no item lines (and not tips). */
  notItemizedCents: number;
}

/**
 * Splits receipts' item lines into categories. A line's category is its matched item's, else
 * the one you set for that name, else a guess from the name.
 */
export function spendByCategory(
  receipts: Pick<Receipt, 'kind' | 'lines' | 'totalCents'>[],
  learned: Map<string, CategoryId>,
  items: Pick<Item, 'id' | 'name' | 'category'>[] = [],
): CategorySpend {
  const byId = new Map(items.map((i) => [i.id, i]));
  const slices = new Map<CategoryId, Map<string, CategoryLine>>();
  let otherCents = 0;
  let notItemizedCents = 0;
  for (const r of receipts) {
    if (r.kind === 'tip') continue;
    const lines = r.lines.filter((l) => l.cents > 0);
    if (!lines.length) {
      notItemizedCents += r.totalCents;
      continue;
    }
    let itemized = 0;
    for (const l of lines) {
      itemized += l.cents;
      const item = l.itemId ? byId.get(l.itemId) : undefined;
      const name = item?.name || l.name || l.raw;
      const key =
        item?.category ??
        learned.get(l.itemKey || catalogKey(name)) ??
        learned.get(catalogKey(name)) ??
        guessCategory(name);
      const group = slices.get(key) ?? new Map<string, CategoryLine>();
      slices.set(key, group);
      const lineKey = catalogKey(name) || name;
      const prev = group.get(lineKey) ?? { name, cents: 0, count: 0 };
      group.set(lineKey, { ...prev, cents: prev.cents + l.cents, count: prev.count + 1 });
    }
    otherCents += r.totalCents - itemized;
  }
  return {
    slices: [...slices.entries()]
      .map(([key, group]) => {
        const lines = [...group.values()].sort((a, b) => b.cents - a.cents);
        return { key, cents: lines.reduce((s, l) => s + l.cents, 0), lines };
      })
      .sort((a, b) => b.cents - a.cents),
    otherCents,
    notItemizedCents,
  };
}
