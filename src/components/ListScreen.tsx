import { useMemo, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { addItems, deleteItems, moveItem, setChecked } from '../data/items';
import { startTrip } from '../data/trips';
import { buildBoard, itemsInView } from '../lib/aisles';
import { estimate, formatCents, lineCents } from '../lib/money';
import { STORES, storeDef } from '../lib/stores';
import { parseQuickAdd } from '../lib/text';
import { notify } from '../push';
import type { Household, Item, ListId, StoreId, Trip, TripMode } from '../types';
import { ItemSheet } from './ItemSheet';
import { Avatar, markerStyle, Sheet, SortIcon } from './ui';

type StoreFilter = StoreId | 'all';

function readPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: fine to forget */
  }
}

const FILTERS: readonly StoreFilter[] = ['all', ...STORES.map((s) => s.id)];

export function ListScreen({
  user,
  household,
  items,
  trips,
}: {
  user: User;
  household: Household;
  items: Item[];
  trips: Trip[];
}) {
  const [list, setList] = useState<ListId>('grocery');
  const [store, setStoreState] = useState<StoreFilter>(() => readPref('fb.store', 'all', FILTERS));
  const [sortByAisle, setSortState] = useState(
    () => readPref('fb.sort', 'off', ['on', 'off'] as const) === 'on',
  );
  const [editing, setEditing] = useState<Item | null>(null);
  const [tripSheet, setTripSheet] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const setStore = (s: StoreFilter) => {
    setStoreState(s);
    writePref('fb.store', s);
  };
  const setSort = (on: boolean) => {
    setSortState(on);
    writePref('fb.sort', on ? 'on' : 'off');
  };

  const onList = useMemo(() => items.filter((i) => i.list === list), [items, list]);
  const rows = useMemo(
    () => buildBoard(onList, { store, sortByAisle, zoneOrder: household.zoneOrder }),
    [onList, store, sortByAisle, household.zoneOrder],
  );
  const total = useMemo(() => estimate(onList, store), [onList, store]);
  const checkedInView = itemsInView(onList, store).filter((i) => i.status === 'checked');
  const activeTrip = store !== 'all' ? trips.find((t) => t.store === store) : undefined;
  const counts = (s: StoreFilter) =>
    itemsInView(onList, s).filter((i) => i.status === 'open').length;

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 3500);
  }

  async function onAdd(text: string, target: StoreId) {
    const entries = parseQuickAdd(text);
    if (!entries.length) return;
    const { added, skipped } = await addItems(household.id, user.uid, entries, {
      list,
      store: target,
      existing: items,
    });
    if (skipped.length)
      flash(`${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} already on the list`);
    else if (added.length > 1) flash(`Added ${added.length} items`);
    if (added.length && list === 'grocery') {
      // The partner's phone merges quick adds into one notification (see public/push-sw.js).
      const actor = household.members[user.uid]?.name ?? 'Your partner';
      void notify(household.id, {
        kind: 'adds',
        actor,
        items: added,
        title:
          added.length > 1 ? `${actor} added ${added.length} items` : `${actor} added ${added[0]}`,
        body: added.join(', '),
        tag: `adds-${user.uid}`,
      });
    }
  }

  async function onStartTrip(mode: TripMode) {
    if (store === 'all') return;
    setTripSheet(false);
    setSort(true);
    await startTrip(household.id, user.uid, store, mode);
    const actor = household.members[user.uid]?.name ?? 'Your partner';
    const open = itemsInView(onList, store).filter((i) => i.status === 'open').length;
    void notify(household.id, {
      kind: 'trip',
      actor,
      title: `${actor} is at ${storeDef(store).name}`,
      body:
        mode === 'together'
          ? `Shopping together. ${open} ${open === 1 ? 'item' : 'items'} on the list.`
          : `Shopping solo with ${open} ${open === 1 ? 'item' : 'items'}. Add anything you need now.`,
      tag: `trip-${store}`,
    });
  }

  return (
    <section className="list-screen">
      <header className="list-head">
        <h1 className="screen-title">{household.name}</h1>
        <div className="who">
          {household.memberIds.map((id) => (
            <Avatar key={id} member={household.members[id]} />
          ))}
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label="List">
        {(['grocery', 'nice'] as const).map((l) => (
          <button
            key={l}
            role="tab"
            aria-selected={list === l}
            className="tab"
            onClick={() => setList(l)}
          >
            {l === 'grocery' ? 'Grocery' : 'Nice-to-have'}
          </button>
        ))}
      </div>

      <div className="pillrow">
        <button
          className="pill-sort"
          aria-pressed={sortByAisle}
          onClick={() => setSort(!sortByAisle)}
        >
          <SortIcon /> Aisle order
        </button>
        <span className="pill-div" aria-hidden="true" />
        <div className="pill-stores" role="group" aria-label="Store">
          {FILTERS.map((s) => (
            <button
              key={s}
              className="spill"
              aria-pressed={store === s}
              onClick={() => setStore(s)}
            >
              {s === 'all' ? 'All' : storeDef(s).name}
              <span className="n">{counts(s)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="board" aria-live="polite">
        {rows.length === 0 && (
          <p className="empty">
            {list === 'grocery'
              ? store === 'all'
                ? 'The board is clear. Add something below.'
                : `Nothing for ${storeDef(store).name} yet.`
              : 'Nothing on the nice-to-have list yet.'}
          </p>
        )}
        {rows.map((row, idx) => {
          if (row.type === 'store')
            return (
              <div className="grp store" key={`s-${row.store}`}>
                {row.label}
              </div>
            );
          if (row.type === 'aisle')
            return (
              <div className="grp" key={`a-${idx}-${row.label}`}>
                {row.label}
              </div>
            );
          const { item } = row;
          const color = household.members[item.createdBy]?.color;
          const line = lineCents(item, row.store);
          const aisle = item.storeInfo[row.store]?.aisle?.label;
          const checker = item.checkedBy ? household.members[item.checkedBy]?.name : undefined;
          return (
            <div
              className={`it marker${item.status === 'checked' ? ' done' : ''}`}
              key={item.id}
              style={markerStyle(color)}
            >
              <button
                className="ck"
                aria-label={`${item.status === 'checked' ? 'Uncheck' : 'Check off'} ${item.name}`}
                aria-pressed={item.status === 'checked'}
                onClick={() =>
                  setChecked(
                    household.id,
                    user.uid,
                    item,
                    item.status !== 'checked',
                    store === 'all' ? undefined : store,
                  )
                }
                title={checker ? `Checked by ${checker}` : undefined}
              />
              <button className="nm" onClick={() => setEditing(item)}>
                {item.name}
                {item.qty > 1 && <span className="qty"> ×{item.qty}</span>}
              </button>
              <span className="meta">
                {store === 'all' && <span className="mag">{storeDef(item.stores[0]).short}</span>}
                {aisle && !sortByAisle && <span className="ai">{aisle}</span>}
                {list === 'nice' && (
                  <button
                    className="to-grocery"
                    onClick={() => moveItem(household.id, user.uid, item, 'grocery')}
                    aria-label={`Move ${item.name} to Grocery`}
                    title="Move to Grocery"
                  >
                    → Grocery
                  </button>
                )}
                <span className={`pr${line == null ? ' none' : ''}`}>
                  {line == null ? '$ –' : formatCents(line)}
                </span>
              </span>
            </div>
          );
        })}
        {checkedInView.length > 0 && (
          <ClearChecked
            count={checkedInView.length}
            onClear={() => deleteItems(household.id, user.uid, checkedInView)}
          />
        )}
      </div>

      <div className="totalbar">
        <span>
          Est. {store === 'all' ? 'all stores' : storeDef(store).name}
          <small>
            {total.open} open{total.missing ? ` · ${total.missing} without a price` : ''}
          </small>
        </span>
        <span className="total-right">
          <span className="mono">{formatCents(total.cents)}</span>
          {store !== 'all' && list === 'grocery' && !activeTrip && (
            <button className="btn small invert" onClick={() => setTripSheet(true)}>
              Start trip
            </button>
          )}
        </span>
      </div>

      <AddBar defaultStore={store === 'all' ? 'ht' : store} list={list} onAdd={onAdd} />

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {editing && (
        <ItemSheet
          key={editing.id}
          item={items.find((i) => i.id === editing.id) ?? editing}
          household={household}
          uid={user.uid}
          focusStore={store === 'all' ? editing.stores[0] : store}
          onClose={() => setEditing(null)}
        />
      )}

      {tripSheet && store !== 'all' && (
        <Sheet
          onClose={() => setTripSheet(false)}
          labelledBy="trip-title"
          title={
            <h2 id="trip-title" className="sheet-title-plain">
              Start a trip to {storeDef(store).name}
            </h2>
          }
        >
          <p className="muted">
            The list switches to aisle order. Your partner sees the trip and every check-off live.
          </p>
          <div className="trip-choices">
            <button className="choice" onClick={() => onStartTrip('together')}>
              <b>Shopping together</b>
              <span>Both phones check off the same list</span>
            </button>
            <button className="choice" onClick={() => onStartTrip('solo')}>
              <b>Shopping solo</b>
              <span>Your partner can add things while you’re there</span>
            </button>
          </div>
        </Sheet>
      )}
    </section>
  );
}

function ClearChecked({ count, onClear }: { count: number; onClear: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="clear-row">
      {confirming ? (
        <>
          <span>
            Remove {count} checked {count === 1 ? 'item' : 'items'}?
          </span>
          <button className="btn small ghost" onClick={() => setConfirming(false)}>
            Keep
          </button>
          <button
            className="btn small danger"
            onClick={() => {
              setConfirming(false);
              onClear();
            }}
          >
            Remove
          </button>
        </>
      ) : (
        <button className="btn link" onClick={() => setConfirming(true)}>
          Clear checked ({count})
        </button>
      )}
    </div>
  );
}

function AddBar({
  defaultStore,
  list,
  onAdd,
}: {
  defaultStore: StoreId;
  list: ListId;
  onAdd: (text: string, store: StoreId) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState<StoreId>(defaultStore);
  const [lastDefault, setLastDefault] = useState(defaultStore);
  if (defaultStore !== lastDefault) {
    setLastDefault(defaultStore);
    setTarget(defaultStore);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = text;
    setText('');
    await onAdd(value, target);
  }

  return (
    <form className="addbar" onSubmit={submit}>
      <label htmlFor="add-input" className="sr-only">
        Add to {list === 'grocery' ? 'Grocery' : 'Nice-to-have'}
      </label>
      <input
        id="add-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={list === 'grocery' ? 'Add items… (eggs, 2 milk)' : 'Add a nice-to-have…'}
        autoComplete="off"
        enterKeyHint="done"
      />
      <label htmlFor="add-store" className="sr-only">
        Store
      </label>
      <select id="add-store" value={target} onChange={(e) => setTarget(e.target.value as StoreId)}>
        {STORES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.short}
          </option>
        ))}
      </select>
      <button className="btn primary add-btn" aria-label="Add" disabled={!text.trim()}>
        +
      </button>
    </form>
  );
}
