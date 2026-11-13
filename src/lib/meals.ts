import { normalizeName } from './text';
import type { Meal, Recipe } from '../types';

/** "2026-11-16" for a date in local time. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The seven day keys of the week starting at `start` (a Monday at local midnight). */
export function weekDays(start: number): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return dayKey(d.getTime());
  });
}

/** "Mon 16" */
export function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const weekday = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
  return `${weekday} ${d}`;
}

/** "Nov 16 – 22" (or across months, "Nov 30 – Dec 6"). */
export function weekLabel(days: string[]): string {
  const at = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const a = at(days[0]);
  const b = at(days[days.length - 1]);
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' });
  return a.getMonth() === b.getMonth()
    ? `${month(a)} ${a.getDate()} – ${b.getDate()}`
    : `${month(a)} ${a.getDate()} – ${month(b)} ${b.getDate()}`;
}

export interface ShoppingLine {
  name: string;
  qty: number;
  staple: boolean;
  /** Already on the Grocery list (open or ordered). */
  already: boolean;
  /** The meals that need it, e.g. ["Tacos", "Chili"]. */
  for: string[];
}

/**
 * Everything the planned recipes need, merged: the same ingredient in two recipes is one line
 * with the quantities added up. Meals without a recipe (a typed note) add nothing.
 */
export function shoppingForMeals(
  meals: Pick<Meal, 'recipeId' | 'title'>[],
  recipes: Pick<Recipe, 'id' | 'title' | 'ingredients'>[],
  onList: Set<string>,
): ShoppingLine[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const lines = new Map<string, ShoppingLine>();
  for (const meal of meals) {
    const recipe = meal.recipeId ? byId.get(meal.recipeId) : undefined;
    if (!recipe) continue;
    for (const ing of recipe.ingredients) {
      const key = normalizeName(ing.name);
      if (!key) continue;
      const line = lines.get(key);
      if (line) {
        line.qty += ing.qty;
        line.staple &&= ing.staple;
        if (!line.for.includes(recipe.title)) line.for.push(recipe.title);
      } else
        lines.set(key, {
          name: ing.name,
          qty: ing.qty,
          staple: ing.staple,
          already: onList.has(key),
          for: [recipe.title],
        });
    }
  }
  return [...lines.values()];
}
