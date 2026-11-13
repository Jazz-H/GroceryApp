import { useMemo, useState } from 'react';
import { addItems } from '../data/items';
import { addMeal, deleteRecipe, removeMeal, saveRecipe, useMeals, useRecipes } from '../data/meals';
import {
  dayKey,
  dayLabel,
  shoppingForMeals,
  weekDays,
  weekLabel,
  type ShoppingLine,
} from '../lib/meals';
import { shiftWeek, weekStart } from '../lib/receipts';
import { STORES } from '../lib/stores';
import { normalizeName } from '../lib/text';
import { notify } from '../push';
import type { CatalogEntry, Household, Item, Meal, Recipe, StoreId } from '../types';
import { CloseIcon } from './icons';
import { RecipeSheet } from './RecipeSheet';
import { Sheet } from './ui';
import { Checkbox } from './ui/checkbox';

/** The Meals tab: this week's plan, "Shop for this week", and the recipe box. */
export function Meals({
  household,
  uid,
  items,
  catalog,
}: {
  household: Household;
  uid: string;
  items: Item[];
  catalog: CatalogEntry[];
}) {
  const [start, setStart] = useState(() => weekStart(Date.now()));
  const days = useMemo(() => weekDays(start), [start]);
  const meals = useMeals(household.id, days[0], days[6]);
  const recipesState = useRecipes(household.id);
  const recipes = useMemo(() => recipesState ?? [], [recipesState]);
  const today = dayKey(Date.now());
  const [planFor, setPlanFor] = useState<string | null>(null);
  const [openRecipe, setOpenRecipe] = useState<Recipe | null>(null);
  const [newRecipe, setNewRecipe] = useState(false);
  const [shopping, setShopping] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  };
  const withRecipe = meals.filter((m) => m.recipeId && recipes.some((r) => r.id === m.recipeId));

  return (
    <section className="meals">
      <h1 className="screen-title">Meals</h1>

      <div className="month-nav">
        <button
          className="btn small ghost"
          onClick={() => setStart(shiftWeek(start, -1))}
          aria-label="Previous week"
        >
          ‹
        </button>
        <span>{start === weekStart(Date.now()) ? 'This week' : weekLabel(days)}</span>
        <button
          className="btn small ghost"
          onClick={() => setStart(shiftWeek(start, 1))}
          aria-label="Next week"
        >
          ›
        </button>
      </div>

      <div className="card meal-week">
        <ul className="meal-days">
          {days.map((d) => {
            const planned = meals.filter((m) => m.date === d);
            return (
              <li key={d} className={d === today ? 'today' : undefined}>
                <span className="meal-day">{dayLabel(d)}</span>
                <span className="meal-chips">
                  {planned.map((m) => (
                    <MealChip
                      key={m.id}
                      meal={m}
                      recipe={recipes.find((r) => r.id === m.recipeId)}
                      onOpen={setOpenRecipe}
                      onRemove={() => removeMeal(household.id, m.id)}
                    />
                  ))}
                </span>
                <button
                  className="meal-add"
                  aria-label={`Plan a meal for ${dayLabel(d)}`}
                  onClick={() => setPlanFor(d)}
                >
                  +
                </button>
              </li>
            );
          })}
        </ul>
        <button
          className="btn primary snap"
          disabled={!withRecipe.length}
          onClick={() => setShopping(true)}
        >
          Shop for {start === weekStart(Date.now()) ? 'this week' : 'that week'}
        </button>
        {!withRecipe.length && (
          <p className="hint">
            Plan a saved recipe on a day, then add everything it needs in one go.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Recipe box</h2>
        {recipesState && recipes.length === 0 && (
          <p className="muted">No recipes yet. Add one from a link, a photo or pasted text.</p>
        )}
        <ul className="recipe-box">
          {recipes.map((r) => (
            <li key={r.id}>
              <button onClick={() => setOpenRecipe(r)}>
                <b>{r.title}</b>
                <span className="hint">
                  {r.ingredients.length} ingredient{r.ingredients.length === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="row-actions">
          <button className="btn ghost" onClick={() => setNewRecipe(true)}>
            Add a recipe
          </button>
        </div>
      </div>

      {planFor && (
        <PlanSheet
          day={planFor}
          recipes={recipes}
          onClose={() => setPlanFor(null)}
          onPlan={async (title, recipeId) => {
            await addMeal(household.id, uid, { date: planFor, title, recipeId });
            setPlanFor(null);
          }}
        />
      )}
      {openRecipe && (
        <RecipeDetail
          recipe={recipes.find((r) => r.id === openRecipe.id) ?? openRecipe}
          days={days}
          onPlan={async (date) => {
            await addMeal(household.id, uid, {
              date,
              title: openRecipe.title,
              recipeId: openRecipe.id,
            });
            setOpenRecipe(null);
            flash(`${openRecipe.title} is planned for ${dayLabel(date)}.`);
          }}
          onDelete={async () => {
            await deleteRecipe(household.id, openRecipe.id);
            setOpenRecipe(null);
          }}
          onClose={() => setOpenRecipe(null)}
        />
      )}
      {newRecipe && (
        <RecipeSheet
          items={items}
          defaultStore="ht"
          saveOnly
          onSave={async (r, source) => {
            await saveRecipe(household.id, uid, {
              title: r.title,
              source,
              ingredients: r.ingredients,
            });
            flash(`Saved ${r.title || 'the recipe'} to the recipe box.`);
          }}
          onAdd={async () => {}}
          onClose={() => setNewRecipe(false)}
        />
      )}
      {shopping && (
        <ShopSheet
          lines={shoppingForMeals(
            withRecipe,
            recipes,
            new Set(
              items
                .filter((i) => i.list === 'grocery' && i.status !== 'checked')
                .map((i) => i.normalizedName || normalizeName(i.name)),
            ),
          )}
          onClose={() => setShopping(false)}
          onAdd={async (entries, store) => {
            const { added } = await addItems(household.id, uid, entries, {
              list: 'grocery',
              store,
              existing: items,
              catalog,
            });
            if (added.length)
              void notify(household.id, 'adds', { items: added.slice(0, 20), count: added.length });
            setShopping(false);
            flash(
              added.length
                ? `Added ${added.length} ${added.length === 1 ? 'item' : 'items'} to Grocery.`
                : 'Everything was already on the list.',
            );
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </section>
  );
}

function MealChip({
  meal,
  recipe,
  onOpen,
  onRemove,
}: {
  meal: Meal;
  recipe?: Recipe;
  onOpen: (r: Recipe) => void;
  onRemove: () => void;
}) {
  return (
    <span className={`meal-chip${recipe ? ' has-recipe' : ''}`}>
      {recipe ? (
        <button className="meal-title" onClick={() => onOpen(recipe)}>
          {meal.title}
        </button>
      ) : (
        <span className="meal-title">{meal.title}</span>
      )}
      <button className="meal-remove" aria-label={`Remove ${meal.title}`} onClick={onRemove}>
        <CloseIcon size={12} />
      </button>
    </span>
  );
}

function PlanSheet({
  day,
  recipes,
  onPlan,
  onClose,
}: {
  day: string;
  recipes: Recipe[];
  onPlan: (title: string, recipeId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const shown = recipes.filter(
    (r) => !text.trim() || r.title.toLowerCase().includes(text.trim().toLowerCase()),
  );
  async function plan(title: string, recipeId: string | null) {
    try {
      await onPlan(title, recipeId);
    } catch {
      setError('Couldn’t save it. Check your connection and try again.');
    }
  }
  return (
    <Sheet
      onClose={onClose}
      labelledBy="plan-title"
      title={
        <h2 id="plan-title" className="sheet-title-plain">
          {dayLabel(day)}
        </h2>
      }
    >
      <form
        className="add-sheet"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void plan(text.trim(), null);
        }}
      >
        <label htmlFor="plan-text" className="sr-only">
          Meal
        </label>
        <input
          id="plan-text"
          className="sheet-name"
          autoFocus
          maxLength={80}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Pick a recipe, or type “Leftovers”"
          autoComplete="off"
        />
        {shown.length > 0 && (
          <ul className="recipe-box">
            {shown.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => plan(r.title, r.id)}>
                  <b>{r.title}</b>
                  <span className="hint">{r.ingredients.length} ingredients</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-actions">
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!text.trim()}>
            Add “{text.trim() || '…'}”
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function RecipeDetail({
  recipe,
  days,
  onPlan,
  onDelete,
  onClose,
}: {
  recipe: Recipe;
  days: string[];
  onPlan: (date: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const today = dayKey(Date.now());
  const [day, setDay] = useState(days.includes(today) ? today : days[0]);
  const [confirm, setConfirm] = useState(false);
  return (
    <Sheet
      onClose={onClose}
      labelledBy="rcp-title"
      title={
        <h2 id="rcp-title" className="sheet-title-plain">
          {recipe.title}
        </h2>
      }
    >
      {recipe.source && (
        <p className="hint">
          <a href={recipe.source} target="_blank" rel="noreferrer">
            Open the original ↗
          </a>
        </p>
      )}
      <ul className="rd-lines">
        {recipe.ingredients.map((ing, i) => (
          <li key={i}>
            <span>
              {ing.qty > 1 && <span className="mono">{ing.qty}× </span>}
              {ing.name}
              {ing.staple && <span className="hint"> · staple</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="plan-row">
        <label htmlFor="rcp-day" className="sr-only">
          Day
        </label>
        <select id="rcp-day" value={day} onChange={(e) => setDay(e.target.value)}>
          {days.map((d) => (
            <option key={d} value={d}>
              {dayLabel(d)}
            </option>
          ))}
        </select>
        <button className="btn primary" onClick={() => onPlan(day)}>
          Plan it
        </button>
      </div>
      <div className="sheet-actions">
        {confirm ? (
          <>
            <span className="muted">Delete {recipe.title}?</span>
            <button className="btn ghost" onClick={() => setConfirm(false)}>
              Keep
            </button>
            <button className="btn danger" onClick={onDelete}>
              Delete
            </button>
          </>
        ) : (
          <>
            <button className="btn link danger-text" onClick={() => setConfirm(true)}>
              Delete recipe
            </button>
            <span className="spacer" />
            <button className="btn ghost" onClick={onClose}>
              Done
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}

function ShopSheet({
  lines,
  onAdd,
  onClose,
}: {
  lines: ShoppingLine[];
  onAdd: (entries: { name: string; qty: number }[], store: StoreId) => Promise<void>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<number>>(
    () => new Set(lines.map((l, i) => (!l.staple && !l.already ? i : -1)).filter((i) => i >= 0)),
  );
  const [store, setStore] = useState<StoreId>('ht');
  const [busy, setBusy] = useState(false);
  const toggle = (i: number) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return (
    <Sheet
      onClose={onClose}
      labelledBy="shop-title"
      title={
        <h2 id="shop-title" className="sheet-title-plain">
          Shop for the week
        </h2>
      }
    >
      <p className="muted">
        Untick anything you have. Staples and things already on the list start unticked.
      </p>
      <ul className="clear-list">
        {lines.map((l, i) => (
          <li key={l.name}>
            <label className="check-label">
              <Checkbox checked={picked.has(i)} onCheckedChange={() => toggle(i)} />
              <span>
                {l.qty > 1 && <span className="mono">{l.qty}× </span>}
                {l.name}
                <span className="muted">
                  {' '}
                  ·{' '}
                  {l.already
                    ? 'already on the list'
                    : l.staple
                      ? 'staple'
                      : `for ${l.for.join(', ')}`}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="segmented small" role="group" aria-label="Store">
        {STORES.map((s) => (
          <button
            type="button"
            key={s.id}
            aria-pressed={store === s.id}
            onClick={() => setStore(s.id)}
          >
            {s.name}
          </button>
        ))}
      </div>
      <div className="sheet-actions">
        <span className="spacer" />
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={busy || picked.size === 0}
          onClick={async () => {
            setBusy(true);
            await onAdd(
              lines.filter((_, i) => picked.has(i)).map((l) => ({ name: l.name, qty: l.qty })),
              store,
            );
          }}
        >
          {busy ? 'Adding…' : `Add ${picked.size} to Grocery`}
        </button>
      </div>
    </Sheet>
  );
}
