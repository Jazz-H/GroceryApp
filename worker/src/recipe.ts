/**
 * Reads a recipe web page for the app: the schema.org Recipe data most recipe sites embed
 * (title and ingredient lines), or else the page's visible text for Gemini to read.
 */

export interface RecipePage {
  title: string;
  /** Ingredient lines as written, when the page has structured recipe data. */
  ingredients: string[];
  /** Visible text (trimmed) when it doesn't. */
  text: string;
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

type Json = Record<string, unknown>;

function findRecipe(node: unknown): Json | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n);
      if (r) return r;
    }
    return null;
  }
  const o = node as Json;
  const type = o['@type'];
  if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) return o;
  return findRecipe(o['@graph']) ?? null;
}

export function parseRecipePage(html: string): RecipePage {
  for (const m of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const recipe = findRecipe(JSON.parse(m[1].trim()));
      const lines = recipe?.recipeIngredient;
      if (recipe && Array.isArray(lines) && lines.length) {
        return {
          title: decode(String(recipe.name ?? ''))
            .trim()
            .slice(0, 120),
          ingredients: lines
            .filter((l): l is string => typeof l === 'string')
            .map((l) => decode(l).replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .slice(0, 80),
          text: '',
        };
      }
    } catch {
      /* not JSON, or not a recipe: keep looking */
    }
  }
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim();
  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|li|h\d|div)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, 20_000);
  return { title: title.slice(0, 120), ingredients: [], text };
}

/** Only fetch ordinary public web pages. */
export function allowedRecipeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
      host.includes(':')
    )
      return null;
    return u;
  } catch {
    return null;
  }
}
