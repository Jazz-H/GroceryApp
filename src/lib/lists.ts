import type { Household, ListDef, ListId } from '../types';

/** Most custom lists a household can have. */
export const MAX_LISTS = 12;

const CUSTOM_ID = /^l_[A-Za-z0-9]{6,20}$/;

export function isCustomListId(value: unknown): value is ListId {
  return typeof value === 'string' && CUSTOM_ID.test(value);
}

export function newListId(random: () => number = Math.random): ListId {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let tail = '';
  for (let i = 0; i < 8; i++) tail += chars[Math.floor(random() * chars.length)];
  return `l_${tail}`;
}

/** Grocery and Nice-to-have, then the household's own lists in the order they were made. */
export function allLists(household: Pick<Household, 'lists'>): ListDef[] {
  return [
    { id: 'grocery', name: 'Grocery' },
    { id: 'nice', name: 'Nice-to-have' },
    ...(household.lists ?? []),
  ];
}

export function listName(id: ListId, household: Pick<Household, 'lists'>): string {
  return allLists(household).find((l) => l.id === id)?.name ?? 'a list';
}

/** Cleans a typed list name; '' when it's empty or clashes with an existing list. */
export function cleanListName(
  name: string,
  household: Pick<Household, 'lists'>,
  except?: ListId,
): string {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 30);
  if (!clean) return '';
  const clash = allLists(household).some(
    (l) => l.id !== except && l.name.toLowerCase() === clean.toLowerCase(),
  );
  return clash ? '' : clean;
}
