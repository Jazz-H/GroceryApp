import { describe, expect, it } from 'vitest';
import { dayKey, shoppingForMeals, weekDays, weekLabel } from './meals';

const monday = new Date(2026, 10, 16).getTime(); // Mon Nov 16 2026

describe('weeks', () => {
  it('lists the seven days from Monday', () => {
    expect(weekDays(monday)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    expect(dayKey(new Date(2026, 0, 5, 23, 30).getTime())).toBe('2026-01-05');
  });

  it('labels a week, across a month end too', () => {
    expect(weekLabel(weekDays(monday))).toMatch(/Nov 16 – 22/);
    expect(weekLabel(weekDays(new Date(2026, 10, 30).getTime()))).toMatch(/Nov 30 – Dec 6/);
  });
});

describe('shoppingForMeals', () => {
  const recipes = [
    {
      id: 'tacos',
      title: 'Tacos',
      ingredients: [
        { name: 'Ground beef', qty: 1, staple: false },
        { name: 'Yellow onion', qty: 1, staple: false },
        { name: 'Salt', qty: 1, staple: true },
      ],
    },
    {
      id: 'chili',
      title: 'Chili',
      ingredients: [
        { name: 'Ground beef', qty: 2, staple: false },
        { name: 'yellow onion', qty: 1, staple: false },
        { name: 'Black beans', qty: 2, staple: false },
      ],
    },
  ];

  it('merges ingredients across meals and notes which meals need them', () => {
    const out = shoppingForMeals(
      [
        { recipeId: 'tacos', title: 'Tacos' },
        { recipeId: 'chili', title: 'Chili' },
        { recipeId: null, title: 'Leftovers' },
      ],
      recipes,
      new Set(['black beans']),
    );
    expect(out).toEqual([
      { name: 'Ground beef', qty: 3, staple: false, already: false, for: ['Tacos', 'Chili'] },
      { name: 'Yellow onion', qty: 2, staple: false, already: false, for: ['Tacos', 'Chili'] },
      { name: 'Salt', qty: 1, staple: true, already: false, for: ['Tacos'] },
      { name: 'Black beans', qty: 2, staple: false, already: true, for: ['Chili'] },
    ]);
  });

  it('counts the same recipe twice when it’s planned twice, and skips deleted recipes', () => {
    const out = shoppingForMeals(
      [
        { recipeId: 'tacos', title: 'Tacos' },
        { recipeId: 'tacos', title: 'Tacos' },
        { recipeId: 'gone', title: 'Old recipe' },
      ],
      recipes,
      new Set(),
    );
    expect(out.find((l) => l.name === 'Ground beef')).toMatchObject({ qty: 2, for: ['Tacos'] });
    expect(out).toHaveLength(3);
  });
});
