import { useEffect, useRef, useState } from 'react';
import { addList, removeList, renameList } from '../data/household';
import { deleteItems } from '../data/items';
import { cleanListName, MAX_LISTS } from '../lib/lists';
import type { Household, Item, ListId } from '../types';
import { Sheet } from './ui';

/**
 * The list tabs: Grocery · Quick add · Nice-to-have · the household's own lists · +.
 * A custom list also gets Rename and Delete under the tabs.
 */
export function ListTabs({
  household,
  uid,
  items,
  list,
  quick,
  onPick,
}: {
  household: Household;
  uid: string;
  items: Item[];
  list: ListId;
  quick: boolean;
  /** quick: the Quick add tab (which adds to Grocery). */
  onPick: (list: ListId, quick: boolean) => void;
}) {
  const custom = household.lists ?? [];
  const current = custom.find((l) => l.id === list);
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const onIt = current ? items.filter((i) => i.list === current.id) : [];
  // Keep the selected tab in view when the row scrolls (many lists, or a long name).
  const row = useRef<HTMLDivElement>(null);
  const names = custom.map((l) => l.name).join('|');
  useEffect(() => {
    row.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [list, quick, names]);

  return (
    <>
      <div className="seg list-tabs" role="tablist" aria-label="List" ref={row}>
        <button
          role="tab"
          aria-selected={!quick && list === 'grocery'}
          onClick={() => onPick('grocery', false)}
        >
          Grocery
        </button>
        <button role="tab" aria-selected={quick} onClick={() => onPick('grocery', true)}>
          Quick add
        </button>
        <button
          role="tab"
          aria-selected={!quick && list === 'nice'}
          onClick={() => onPick('nice', false)}
        >
          Nice-to-have
        </button>
        {custom.map((l) => (
          <button
            key={l.id}
            role="tab"
            aria-selected={!quick && list === l.id}
            onClick={() => onPick(l.id, false)}
          >
            {l.name}
          </button>
        ))}
        {custom.length < MAX_LISTS && (
          <button
            className="list-new"
            aria-label="New list"
            title="New list"
            onClick={() => setNaming('new')}
          >
            +
          </button>
        )}
      </div>

      {current && !quick && (
        <div className="list-actions">
          {confirmDelete ? (
            <>
              <span className="muted list-confirm">
                Delete {current.name}
                {onIt.length
                  ? ` and its ${onIt.length} ${onIt.length === 1 ? 'item' : 'items'}`
                  : ''}
                ?
              </span>
              <button className="btn ghost small" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
              <button
                className="btn danger small"
                onClick={async () => {
                  setConfirmDelete(false);
                  await deleteItems(household.id, uid, onIt);
                  await removeList(household, current.id);
                  onPick('grocery', false);
                }}
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <button className="btn link" onClick={() => setNaming('rename')}>
                Rename
              </button>
              <button className="btn link danger-text" onClick={() => setConfirmDelete(true)}>
                Delete list…
              </button>
            </>
          )}
        </div>
      )}

      {naming && (
        <NameSheet
          household={household}
          initial={naming === 'rename' ? (current?.name ?? '') : ''}
          except={naming === 'rename' ? current?.id : undefined}
          onClose={() => setNaming(null)}
          onSave={async (name) => {
            if (naming === 'rename' && current) await renameList(household, current.id, name);
            else onPick(await addList(household, name), false);
            setNaming(null);
          }}
        />
      )}
    </>
  );
}

function NameSheet({
  household,
  initial,
  except,
  onClose,
  onSave,
}: {
  household: Household;
  initial: string;
  except?: ListId;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      onClose={onClose}
      labelledBy="list-name-title"
      title={
        <h2 id="list-name-title" className="sheet-title-plain">
          {except ? 'Rename list' : 'New list'}
        </h2>
      }
    >
      <form
        className="add-sheet"
        onSubmit={async (e) => {
          e.preventDefault();
          const clean = cleanListName(name, household, except);
          if (!clean)
            return setError(
              name.trim() ? 'You already have a list with that name.' : 'Give the list a name.',
            );
          setBusy(true);
          try {
            await onSave(clean);
          } catch {
            setError('Couldn’t save it. Check your connection and try again.');
            setBusy(false);
          }
        }}
      >
        <label htmlFor="list-name" className="sr-only">
          List name
        </label>
        <input
          id="list-name"
          className="sheet-name"
          autoFocus
          value={name}
          maxLength={30}
          placeholder="Costco, Party, Hardware…"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'list-name-error' : undefined}
        />
        {error && (
          <p className="error" id="list-name-error" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-actions">
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {except ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
