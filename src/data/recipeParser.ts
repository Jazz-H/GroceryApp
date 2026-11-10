import { app, auth, usingEmulators } from '../firebase';

const MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.6-flash';
const RELAY_URL = (import.meta.env.VITE_PUSH_URL ?? '').replace(/\/$/, '');

const PROMPT = `You are turning ONE recipe (text, ingredient lines, or photos of a recipe card,
cookbook page or screenshot) into a grocery list. Return JSON only.

title: the recipe's name, or "" if there isn't one.
ingredients: one entry per ingredient someone would buy, in recipe order.
  name: a short shopping-list name in plain English, without amounts, prep or brand unless it
    matters ("2 cups diced yellow onion" → "Yellow onion"; "1 (15 oz) can black beans, rinsed"
    → "Black beans").
  qty: how many to buy as a whole number (packages, cans, items), usually 1.
  staple: true for things most kitchens already have (salt, pepper, cooking oil, water, sugar,
    flour, common dried spices), otherwise false.
Combine duplicates. Skip equipment and sub-recipe headings. Don't invent ingredients.`;

export interface RecipeIngredient {
  name: string;
  qty: number;
  staple: boolean;
}

export interface ParsedRecipe {
  title: string;
  ingredients: RecipeIngredient[];
}

export class RecipeError extends Error {}

/** A link → the page's recipe data or text, read by the relay (browsers can't fetch other sites). */
async function readLink(url: string): Promise<string> {
  if (!RELAY_URL) throw new RecipeError('Reading links needs the notification relay set up.');
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new RecipeError('Sign in first.');
  const res = await fetch(`${RELAY_URL}/recipe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }).catch(() => null);
  if (!res) throw new RecipeError('Couldn’t reach the page. Check your connection.');
  const body = (await res.json().catch(() => ({}))) as {
    title?: string;
    ingredients?: string[];
    text?: string;
    error?: string;
  };
  if (!res.ok) throw new RecipeError(body.error ?? `Couldn’t read that link (${res.status}).`);
  if (body.ingredients?.length)
    return `Recipe: ${body.title ?? ''}\nIngredients:\n${body.ingredients.join('\n')}`;
  if (body.text) return `Page: ${body.title ?? ''}\n${body.text}`;
  throw new RecipeError(
    'That page didn’t have a recipe I could read. Try pasting the ingredients.',
  );
}

export function isLink(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

/** Reads a recipe from pasted text, a link, or photos (base64 JPEG) and returns what to buy. */
export async function parseRecipe(input: {
  text?: string;
  images?: string[];
}): Promise<ParsedRecipe> {
  const raw = input.text?.trim() ?? '';
  const images = input.images ?? [];
  if (!raw && !images.length) throw new RecipeError('Paste a recipe or a link, or add a photo.');
  const text = raw && isLink(raw) ? await readLink(raw) : raw;
  if (usingEmulators) return sampleRecipe(text);

  const { getAI, getGenerativeModel, GoogleAIBackend, Schema } = await import('firebase/ai');
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const model = getGenerativeModel(ai, {
    model: MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0,
      responseSchema: Schema.object({
        properties: {
          title: Schema.string(),
          ingredients: Schema.array({
            items: Schema.object({
              properties: {
                name: Schema.string(),
                qty: Schema.integer(),
                staple: Schema.boolean(),
              },
            }),
          }),
        },
      }),
    },
  });
  let out: string;
  try {
    const result = await model.generateContent([
      PROMPT,
      ...(text ? [text.slice(0, 30_000)] : []),
      ...images.map((data) => ({ inlineData: { data, mimeType: 'image/jpeg' } })),
    ]);
    out = result.response.text();
  } catch (e) {
    const msg = (e as Error).message ?? '';
    throw new RecipeError(
      /quota|429/i.test(msg)
        ? 'Gemini’s free daily limit is used up. Try again later.'
        : `Couldn’t read the recipe: ${msg}`,
    );
  }
  return cleanRecipe(JSON.parse(out));
}

/** Validates the model's answer: trimmed names, sane quantities, duplicates merged. */
export function cleanRecipe(raw: unknown): ParsedRecipe {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.ingredients) ? r.ingredients : [];
  const byName = new Map<string, RecipeIngredient>();
  for (const i of list.slice(0, 80)) {
    const o = (i && typeof i === 'object' ? i : {}) as Record<string, unknown>;
    const name = String(o.name ?? '')
      .replace(/,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    if (!name) continue;
    const key = name.toLowerCase();
    const qty = Math.min(99, Math.max(1, Math.round(Number(o.qty) || 1)));
    const prev = byName.get(key);
    if (prev) prev.qty = Math.min(99, prev.qty + qty);
    else byName.set(key, { name, qty, staple: o.staple === true });
  }
  return {
    title: String(r.title ?? '')
      .trim()
      .slice(0, 120),
    ingredients: [...byName.values()],
  };
}

function sampleRecipe(text: string): ParsedRecipe {
  return cleanRecipe({
    title: text.startsWith('Recipe:') ? text.split('\n')[0].slice(8) : 'Sample tacos',
    ingredients: [
      { name: 'Ground beef', qty: 1, staple: false },
      { name: 'Taco shells', qty: 1, staple: false },
      { name: 'Shredded cheddar', qty: 1, staple: false },
      { name: 'Salt', qty: 1, staple: true },
    ],
  });
}
