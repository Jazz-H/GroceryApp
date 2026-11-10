import { describe, expect, it } from 'vitest';
import { allowedRecipeUrl, parseRecipePage } from './recipe';

describe('recipe pages', () => {
  it('reads schema.org Recipe data, including inside @graph', () => {
    const html = `<html><head><title>Ignore me</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"WebPage","name":"x"},
        {"@type":["Recipe"],"name":"Chicken &amp; Rice","recipeIngredient":["2 cups rice","1 lb chicken breasts","Salt"]}
      ]}</script></head><body>…</body></html>`;
    expect(parseRecipePage(html)).toEqual({
      title: 'Chicken & Rice',
      ingredients: ['2 cups rice', '1 lb chicken breasts', 'Salt'],
      text: '',
    });
  });

  it('falls back to visible text', () => {
    const page = parseRecipePage(
      '<title>Pancakes</title><style>.x{}</style><p>1 cup flour</p><p>2 eggs</p><script>bad()</script>',
    );
    expect(page.title).toBe('Pancakes');
    expect(page.ingredients).toEqual([]);
    expect(page.text).toContain('1 cup flour');
    expect(page.text).not.toContain('bad()');
  });

  it('only allows public http(s) pages', () => {
    expect(allowedRecipeUrl('https://www.allrecipes.com/recipe/1')?.hostname).toBe(
      'www.allrecipes.com',
    );
    expect(allowedRecipeUrl('http://127.0.0.1/admin')).toBeNull();
    expect(allowedRecipeUrl('http://localhost:8080')).toBeNull();
    expect(allowedRecipeUrl('file:///etc/passwd')).toBeNull();
    expect(allowedRecipeUrl('not a url')).toBeNull();
  });
});
