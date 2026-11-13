import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { isLink, parseRecipe, RecipeError, type ParsedRecipe } from '../data/recipeParser';
import { STORES } from '../lib/stores';
import { normalizeName, type QuickAdd } from '../lib/text';
import type { Item, StoreId } from '../types';
import { CameraIcon, CloseIcon } from './icons';
import { Sheet } from './ui';
import { Checkbox } from './ui/checkbox';
import { Button } from './ui/button';

/** A photo as base64 JPEG, at most 1600px on its long side. */
async function toJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.82).split(',')[1];
}

/**
 * Drop in a recipe (paste text or a link, or add photos of a recipe card or screenshot), pick
 * which ingredients you need, and add them to the list.
 */
export function RecipeSheet({
  items,
  defaultStore,
  onAdd,
  onSave,
  saveOnly = false,
  onClose,
}: {
  items: Item[];
  defaultStore: StoreId;
  onAdd: (entries: QuickAdd[], store: StoreId) => Promise<void>;
  /** Saves the recipe to the recipe box (source: the link, or ''). */
  onSave?: (recipe: ParsedRecipe, source: string) => Promise<void>;
  /** From the recipe box: only save, don't offer adding to the list. */
  saveOnly?: boolean;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<{ name: string; data: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<ParsedRecipe | null>(null);
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  const [store, setStore] = useState<StoreId>(defaultStore);
  const [dragging, setDragging] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (!recipe || !onSave) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(recipe, isLink(text) ? text.trim() : '');
      setSaved(true);
      if (saveOnly) onClose();
    } catch {
      setError('Couldn’t save the recipe. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }
  const fileInput = useRef<HTMLInputElement>(null);

  const onList = useMemo(
    () =>
      new Set(
        items
          .filter((i) => i.list === 'grocery' && i.status !== 'checked')
          .map((i) => i.normalizedName),
      ),
    [items],
  );

  async function addFiles(files: FileList | File[]) {
    setError(null);
    const images = [...files].filter((f) => f.type.startsWith('image/')).slice(0, 4);
    const out: { name: string; data: string }[] = [];
    for (const f of images) {
      try {
        out.push({ name: f.name, data: await toJpeg(f) });
      } catch {
        setError(`Couldn’t open ${f.name}. Use a photo or screenshot.`);
      }
    }
    setPhotos((p) => [...p, ...out].slice(0, 4));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
    else {
      const dropped = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text');
      if (dropped) setText(dropped.trim());
    }
  }

  async function read() {
    setBusy(true);
    setError(null);
    try {
      const r = await parseRecipe({ text, images: photos.map((p) => p.data) });
      if (!r.ingredients.length) throw new RecipeError('I couldn’t find any ingredients in that.');
      setRecipe(r);
      // Tick everything except pantry staples and things already on the list.
      setPicked(
        new Set(
          r.ingredients
            .map((ing, i) => (!ing.staple && !onList.has(normalizeName(ing.name)) ? i : -1))
            .filter((i) => i >= 0),
        ),
      );
    } catch (e) {
      setError(
        e instanceof RecipeError ? e.message : `Couldn’t read the recipe: ${(e as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!recipe) return;
    const entries = recipe.ingredients
      .filter((_, i) => picked.has(i))
      .map((ing) => ({ name: ing.name, qty: ing.qty }));
    if (!entries.length) return;
    setBusy(true);
    await onAdd(entries, store);
    onClose();
  }

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
      labelledBy="recipe-title"
      title={
        <h2 id="recipe-title" className="sheet-title-plain">
          {recipe ? recipe.title || 'Ingredients' : 'Add from a recipe'}
        </h2>
      }
    >
      {!recipe ? (
        <div
          className={`recipe-drop${dragging ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <label htmlFor="recipe-text" className="sr-only">
            Recipe text or link
          </label>
          <textarea
            id="recipe-text"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a recipe link, or the ingredients, or drop a photo here"
          />
          <p className="hint">
            Works with most recipe sites, a screenshot, or a photo of a recipe card.
          </p>
          <div className="row-actions">
            <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()}>
              <CameraIcon />
              Photo or screenshot
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          {photos.length > 0 && (
            <ul className="recipe-photos">
              {photos.map((p, i) => (
                <li key={i}>
                  <img src={`data:image/jpeg;base64,${p.data}`} alt={`Recipe photo ${i + 1}`} />
                  <button
                    type="button"
                    className="thumb-remove"
                    aria-label={`Remove photo ${i + 1}`}
                    onClick={() => setPhotos((all) => all.filter((_, j) => j !== i))}
                  >
                    <CloseIcon size={14} />
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
          {busy && (
            <p className="hint" role="status">
              Reading the recipe. This takes a few seconds…
            </p>
          )}
          <div className="sheet-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"

              onClick={read}
              disabled={busy || (!text.trim() && !photos.length)}
            >
              {busy ? 'Reading…' : 'Get ingredients'}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {!saveOnly && (
            <p className="muted">
              Untick anything you already have. Pantry staples and things already on the list start
              unticked.
            </p>
          )}
          <ul className="clear-list">
            {recipe.ingredients.map((ing, i) => {
              const already = onList.has(normalizeName(ing.name));
              return (
                <li key={i}>
                  <label className="check-label">
                    {!saveOnly && (
                      <Checkbox checked={picked.has(i)} onCheckedChange={() => toggle(i)} />
                    )}
                    <span>
                      {ing.qty > 1 && <span className="mono">{ing.qty}× </span>}
                      {ing.name}
                      {(ing.staple || already) && (
                        <span className="muted">
                          {' '}
                          · {already ? 'already on the list' : 'pantry staple'}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!saveOnly && (
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
          )}
          <div className="sheet-actions">
            <Button type="button" variant="secondary" onClick={() => setRecipe(null)}>
              Back
            </Button>
            {onSave && (
              <Button
                type="button"
                variant={saveOnly ? undefined : 'secondary'}
                onClick={save}
                disabled={busy || saved}
              >
                {saved ? 'Saved ✓' : saveOnly ? 'Save to recipe box' : 'Save recipe'}
              </Button>
            )}
            {!saveOnly && (
              <Button
                type="button"

                onClick={add}
                disabled={busy || picked.size === 0}
              >
                {busy ? 'Adding…' : `Add ${picked.size} to list`}
              </Button>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
