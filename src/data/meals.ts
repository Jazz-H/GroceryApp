import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase';
import type { Meal, Recipe, RecipeIngredient } from '../types';
import { ms } from './convert';

const recipes = (hid: string) => collection(db, 'households', hid, 'recipes');
const meals = (hid: string) => collection(db, 'households', hid, 'meals');

function toIngredient(d: DocumentData): RecipeIngredient {
  return {
    name: String(d?.name ?? '').slice(0, 120),
    qty: typeof d?.qty === 'number' && d.qty >= 1 ? Math.min(99, Math.round(d.qty)) : 1,
    staple: d?.staple === true,
  };
}

export function useRecipes(hid: string): Recipe[] | null {
  const [list, setList] = useState<Recipe[] | null>(null);
  useEffect(
    () =>
      onSnapshot(
        query(recipes(hid), orderBy('title')),
        (snap) =>
          setList(
            snap.docs.map((d) => {
              const v = d.data({ serverTimestamps: 'estimate' });
              return {
                id: d.id,
                title: String(v.title ?? 'Recipe'),
                source: String(v.source ?? ''),
                ingredients: (Array.isArray(v.ingredients) ? v.ingredients : [])
                  .map(toIngredient)
                  .filter((i: RecipeIngredient) => i.name),
                createdBy: String(v.createdBy ?? ''),
                createdAt: ms(v.createdAt),
              };
            }),
          ),
        () => setList([]),
      ),
    [hid],
  );
  return list;
}

/** Meals planned from `from` to `to` (day keys, inclusive), in date order. */
export function useMeals(hid: string, from: string, to: string): Meal[] {
  const [list, setList] = useState<Meal[]>([]);
  useEffect(
    () =>
      onSnapshot(
        query(meals(hid), where('date', '>=', from), where('date', '<=', to), orderBy('date')),
        (snap) =>
          setList(
            snap.docs.map((d) => {
              const v = d.data({ serverTimestamps: 'estimate' });
              return {
                id: d.id,
                date: String(v.date ?? ''),
                title: String(v.title ?? ''),
                recipeId: typeof v.recipeId === 'string' ? v.recipeId : null,
                by: String(v.by ?? ''),
                createdAt: ms(v.createdAt),
              };
            }),
          ),
        () => setList([]),
      ),
    [hid, from, to],
  );
  return list;
}

export async function saveRecipe(
  hid: string,
  uid: string,
  recipe: { title: string; source: string; ingredients: RecipeIngredient[] },
): Promise<string> {
  const ref = await addDoc(recipes(hid), {
    title: recipe.title.trim().slice(0, 120) || 'Recipe',
    source: recipe.source.slice(0, 500),
    ingredients: recipe.ingredients.slice(0, 60).map((i) => ({
      name: i.name.slice(0, 120),
      qty: Math.min(99, Math.max(1, Math.round(i.qty) || 1)),
      staple: i.staple,
    })),
    createdBy: uid,
    createdAt: Date.now(),
  });
  return ref.id;
}

export async function deleteRecipe(hid: string, id: string) {
  await deleteDoc(doc(recipes(hid), id));
}

export async function addMeal(
  hid: string,
  uid: string,
  meal: { date: string; title: string; recipeId: string | null },
) {
  await addDoc(meals(hid), {
    date: meal.date,
    title: meal.title.trim().slice(0, 80),
    recipeId: meal.recipeId,
    by: uid,
    createdAt: Date.now(),
  });
}

export async function removeMeal(hid: string, id: string) {
  await deleteDoc(doc(meals(hid), id));
}
