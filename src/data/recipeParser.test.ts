import { describe, expect, it, vi } from 'vitest';

vi.mock('../firebase', () => ({ app: {}, auth: {}, usingEmulators: true }));
const { cleanRecipe, isLink } = await import('./recipeParser');

describe('recipe parsing', () => {
  it('cleans names, clamps quantities and merges duplicates', () => {
    expect(
      cleanRecipe({
        title: ' Tacos ',
        ingredients: [
          { name: 'Ground beef', qty: 2, staple: false },
          { name: 'ground beef', qty: 1 },
          { name: 'Salt, kosher', qty: 0, staple: true },
          { name: '   ' },
          'junk',
        ],
      }),
    ).toEqual({
      title: 'Tacos',
      ingredients: [
        { name: 'Ground beef', qty: 3, staple: false },
        { name: 'Salt kosher', qty: 1, staple: true },
      ],
    });
  });

  it('spots links', () => {
    expect(isLink('https://www.allrecipes.com/recipe/123')).toBe(true);
    expect(isLink('2 cups rice\n1 onion')).toBe(false);
  });
});
