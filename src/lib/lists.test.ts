import { describe, expect, it } from 'vitest';
import { allLists, cleanListName, isCustomListId, listName, newListId } from './lists';

const household = { lists: [{ id: 'l_costco01' as const, name: 'Costco' }] };

describe('lists', () => {
  it('puts the built-in lists first', () => {
    expect(allLists(household).map((l) => l.name)).toEqual(['Grocery', 'Nice-to-have', 'Costco']);
    expect(allLists({}).map((l) => l.id)).toEqual(['grocery', 'nice']);
  });

  it('names lists, with a fallback for one that was deleted', () => {
    expect(listName('nice', household)).toBe('Nice-to-have');
    expect(listName('l_costco01', household)).toBe('Costco');
    expect(listName('l_gone0000', household)).toBe('a list');
  });

  it('makes ids the rules accept', () => {
    const id = newListId();
    expect(isCustomListId(id)).toBe(true);
    expect(isCustomListId('grocery')).toBe(false);
    expect(isCustomListId('l_x')).toBe(false);
  });

  it('cleans names and refuses clashes', () => {
    expect(cleanListName('  Party   supplies ', household)).toBe('Party supplies');
    expect(cleanListName('costco', household)).toBe('');
    expect(cleanListName('grocery', household)).toBe('');
    expect(cleanListName('Costco', household, 'l_costco01')).toBe('Costco');
    expect(cleanListName('   ', household)).toBe('');
  });
});
