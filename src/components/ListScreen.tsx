import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from 'react';
import type { User } from 'firebase/auth';
import {
  addItems,
  deleteItems,
  moveItem,
  pickUpOrder,
  placeOrder,
  setChecked,
} from '../data/items';
import { startTrip } from '../data/trips';
import { buildBoard, itemsInView, ORDERED } from '../lib/aisles';
import { estimate, formatCents, lineCents } from '../lib/money';
import { STORES, storeDef } from '../lib/stores';
import { parseQuickAdd, type QuickAdd } from '../lib/text';
import { suggestUsuals, type Usual } from '../lib/usuals';
import { notify } from '../push';
import type {
  ActivityEvent,
  CatalogEntry,
  Household,
  Item,
  ListId,
  StoreId,
  Trip,
  TripMode,
} from '../types';
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

/** How long a removal waits for Undo before it really happens. */
const UNDO_MS = 6000;

/** Target's own search for an item, which opens the Target app on phones that have it. */
function targetSearchUrl(name: string): string {
  return 'https://www.target.com/s?searchTerm=' + encodeURIComponent(name);
}

function readCart(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem('fb.cart') ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function writeCart(ids: Set<string>) {
  writePref('fb.cart', JSON.stringify([...ids]));
}

export function ListScreen({
  user,
  household,
  items,
  loading = false,
  trips,
  catalog = [],
  activity = [],
}: {
  user: User;
  household: Household;
  items: Item[];
  loading?: boolean;
  trips: Trip[];
  catalog?: CatalogEntry[];
  activity?: ActivityEvent[];
}) {
  const [list, setList] = useState<ListId>('grocery');
  const [store, setStoreState] = useState<StoreFilter>(() => readPref('fb.store', 'all', FILTERS));
  const [sortByAisle, setSortState] = useState(
    () => readPref('fb.sort', 'off', ['on', 'off'] as const) === 'on',
  );
  const [editing, setEditing] = useState<Item | null>(null);
  const [tripSheet, setTripSheet] = useState(false);
  const [adding, setAdding] = useState(false);
  const keyboardProxy = useRef<HTMLInputElement>(null);

  /** A tap on a blank line, the empty message or a group heading opens the add pop-up.
   *  Taps on items (and their buttons) keep doing what they do. */
  function onBoardTap(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const blank =
      target === e.currentTarget ||
      target.classList.contains('empty') ||
      target.classList.contains('grp') ||
      target.classList.contains('clear-row');
    if (!blank || loading) return;
    keyboardProxy.current?.focus();
    setAdding(true);
  }
  // Store picked inside the trip sheet when it was opened from the All view.
  const [tripStore, setTripStore] = useState<StoreId | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const setStore = (s: StoreFilter) => {
    setStoreState(s);
    writePref('fb.store', s);
  };
  const setSort = (on: boolean) => {
    setSortState(on);
    writePref('fb.sort', on ? 'on' : 'off');
  };

  // ---- Removals wait UNDO_MS for Undo, hidden from the board meanwhile ----
  const [pending, setPending] = useState<{ items: Item[]; label: string } | null>(null);
  const pendingRef = useRef(pending);
  const pendingTimer = useRef(0);
  const commitPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    window.clearTimeout(pendingTimer.current);
    pendingRef.current = null;
    setPending(null);
    void deleteItems(household.id, user.uid, p.items);
    // Everything else it touches is a ref or a stable setter, so this is
    // stable across renders — which is what lets the listener effect below
    // depend on it instead of suppressing the rule.
  }, [household.id, user.uid]);
  function removeWithUndo(toRemove: Item[]) {
    if (!toRemove.length) return;
    commitPending();
    const p = {
      items: toRemove,
      label:
        toRemove.length === 1
          ? 'Removed ' + toRemove[0].name
          : 'Removed ' + toRemove.length + ' items',
    };
    pendingRef.current = p;
    setPending(p);
    pendingTimer.current = window.setTimeout(commitPending, UNDO_MS);
  }
  function undoRemove() {
    window.clearTimeout(pendingTimer.current);
    pendingRef.current = null;
    setPending(null);
  }
  // Don't lose a removal when the app is closed, hidden or left for another tab.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && commitPending();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', commitPending);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', commitPending);
      commitPending();
    };
    // commitPending, not []. The cleanup commits the pending removal, so an
    // effect that re-ran every render would commit immediately and there
    // would be no undo window at all. useCallback above keeps it stable, so
    // this re-binds only when the household or user changes.
  }, [commitPending]);

  const visibleItems = useMemo(() => {
    const hidden = new Set(pending?.items.map((i) => i.id));
    return hidden.size ? items.filter((i) => !hidden.has(i.id)) : items;
  }, [items, pending]);
  const onList = useMemo(() => visibleItems.filter((i) => i.list === list), [visibleItems, list]);

  // ---- Usuals ----
  const usuals = useMemo(
    () => suggestUsuals(catalog, activity, visibleItems),
    [catalog, activity, visibleItems],
  );

  // ---- Target pickup order ----
  const [pickupMode, setPickupMode] = useState(false);
  const [cart, setCartState] = useState<Set<string>>(readCart);
  const setCart = (next: Set<string>) => {
    setCartState(next);
    writeCart(next);
  };
  const showPickup = store === 'target' && list === 'grocery';
  const cartItems = onList.filter(
    (i) => cart.has(i.id) && i.status === 'open' && i.stores.includes('target'),
  );
  const orderedInView = itemsInView(onList, store).filter((i) => i.status === 'ordered');
  async function onOrderPlaced() {
    const n = cartItems.length;
    await placeOrder(household.id, user.uid, cartItems, 'target');
    setCart(new Set());
    setPickupMode(false);
    flash('Order placed: ' + n + (n === 1 ? ' item' : ' items') + ' moved to “Ordered for pickup”');
  }
  const rows = useMemo(
    () => buildBoard(onList, { store, sortByAisle, zoneOrder: household.zoneOrder }),
    [onList, store, sortByAisle, household.zoneOrder],
  );
  const total = useMemo(() => estimate(onList, store), [onList, store]);
  const checkedInView = itemsInView(onList, store).filter((i) => i.status === 'checked');
  const activeTrip =
    store !== 'all'
      ? trips.find((t) => t.store === store)
      : trips.find((t) => t.participants.includes(user.uid));
  const inMyTrip = trips.some((t) => t.participants.includes(user.uid));

  // A trip turns on aisle order. When the trip ends (from the banner, or by the partner), put
  // the sort back the way it was. Only on a real end: not on first load, when trips are still [].
  const wasInTrip = useRef<boolean | null>(null);
  useEffect(() => {
    const before = wasInTrip.current;
    wasInTrip.current = inMyTrip;
    if (before === true && !inMyTrip) {
      const saved = readPref('fb.sortBeforeTrip', '', ['on', 'off', ''] as const);
      if (saved) setSort(saved === 'on');
      try {
        localStorage.removeItem('fb.sortBeforeTrip');
      } catch {
        /* private mode */
      }
    }
  }, [inMyTrip]);
  const counts = (s: StoreFilter) =>
    itemsInView(onList, s).filter((i) => i.status === 'open').length;

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 3500);
  }

  async function onAdd(text: string, target: StoreId) {
    await addEntries(parseQuickAdd(text), target);
  }

  /** A usual is added exactly as named (no quantity parsing), at the store it's bought at. */
  async function addUsual(u: Usual) {
    await addEntries([{ name: u.name, qty: 1 }], u.store);
  }

  async function addEntries(entries: QuickAdd[], target: StoreId) {
    if (!entries.length) return;
    const { added, skipped } = await addItems(household.id, user.uid, entries, {
      list,
      store: target,
      existing: visibleItems,
      catalog,
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
    const target = store === 'all' ? tripStore : store;
    if (!target) return;
    setTripSheet(false);
    setTripStore(null);
    // Show that store's list for the trip.
    if (store !== target) setStore(target);
    writePref('fb.sortBeforeTrip', sortByAisle ? 'on' : 'off');
    setSort(true);
    await startTripAt(target, mode);
  }

  async function startTripAt(store: StoreId, mode: TripMode) {
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

      {/* iOS only raises the keyboard for a field focused during the tap itself, so the tap
          focuses this hidden field and the add pop-up's field takes over from it. */}
      <input ref={keyboardProxy} className="keyboard-proxy" aria-hidden="true" tabIndex={-1} />
      {showPickup && (
        <div className="pickup-bar">
          {pickupMode ? (
            <>
              <span>Find each item on Target, then mark it Added.</span>
              <button
                className="btn small primary"
                disabled={!cartItems.length}
                onClick={onOrderPlaced}
              >
                Order placed ({cartItems.length})
              </button>
              <button className="btn small ghost" onClick={() => setPickupMode(false)}>
                Done
              </button>
            </>
          ) : (
            <>
              <span>Ordering for pickup?</span>
              <button className="btn small ghost" onClick={() => setPickupMode(true)}>
                Build pickup order
              </button>
            </>
          )}
        </div>
      )}
      <div className="board" aria-live="polite" onClick={onBoardTap}>
        {rows.length === 0 && (
          <p className="empty">
            {loading
              ? 'Loading the board…'
              : list === 'grocery'
                ? store === 'all'
                  ? 'The board is clear. Tap anywhere to add something.'
                  : `Nothing for ${storeDef(store).name} yet. Tap to add something.`
                : 'Nothing on the nice-to-have list yet. Tap to add something.'}
          </p>
        )}
        {rows.map((row, idx) => {
          if (row.type === 'store')
            return (
              <div className="grp store" key={`s-${row.store}`}>
                {row.label}
              </div>
            );
          if (row.type === 'aisle' && row.label === ORDERED)
            return (
              <div className="grp ordered-head" key="ordered">
                <span>{row.label}</span>
                <button
                  className="btn small ghost"
                  onClick={() =>
                    pickUpOrder(
                      household.id,
                      user.uid,
                      orderedInView,
                      store === 'all' ? (orderedInView[0]?.stores[0] ?? 'target') : store,
                    )
                  }
                >
                  Picked up
                </button>
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
              className={`it marker${item.status === 'checked' ? ' done' : ''}${item.status === 'ordered' ? ' is-ordered' : ''}`}
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
                {pickupMode && showPickup && item.status === 'open' && (
                  <>
                    <a
                      className="find"
                      href={targetSearchUrl(item.name)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={'Find ' + item.name + ' on Target.com'}
                    >
                      Find ↗
                    </a>
                    <button
                      className="cart"
                      aria-pressed={cart.has(item.id)}
                      aria-label={item.name + ' added to the Target cart'}
                      onClick={() => {
                        const next = new Set(cart);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        setCart(next);
                      }}
                    >
                      {cart.has(item.id) ? '✓ Added' : 'Added?'}
                    </button>
                  </>
                )}
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
          <div className="clear-row">
            <button className="btn link" onClick={() => removeWithUndo(checkedInView)}>
              Clear checked ({checkedInView.length})
            </button>
          </div>
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
          {list === 'grocery' && !activeTrip && (
            <button className="btn small invert" onClick={() => setTripSheet(true)}>
              Start trip
            </button>
          )}
        </span>
      </div>

      {list === 'grocery' && <UsualsRow usuals={usuals} onPick={addUsual} />}

      <AddBar defaultStore={store === 'all' ? 'ht' : store} list={list} onAdd={onAdd} />

      {adding && (
        <AddSheet
          defaultStore={store === 'all' ? 'ht' : store}
          list={list}
          onAdd={onAdd}
          usuals={list === 'grocery' ? usuals : []}
          onPickUsual={addUsual}
          onClose={() => setAdding(false)}
        />
      )}

      {pending ? (
        <div className="toast with-action" role="status">
          <span>{pending.label}</span>
          <button className="btn small invert" onClick={undoRemove}>
            Undo
          </button>
        </div>
      ) : (
        toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )
      )}

      {editing && (
        <ItemSheet
          key={editing.id}
          item={items.find((i) => i.id === editing.id) ?? editing}
          household={household}
          uid={user.uid}
          focusStore={store === 'all' ? editing.stores[0] : store}
          onRemove={(item) => removeWithUndo([item])}
          onClose={() => setEditing(null)}
        />
      )}

      {tripSheet && store === 'all' && !tripStore && (
        <Sheet
          onClose={() => setTripSheet(false)}
          labelledBy="trip-title"
          title={
            <h2 id="trip-title" className="sheet-title-plain">
              Where are you shopping?
            </h2>
          }
        >
          <div className="trip-choices">
            {STORES.map((s) => (
              <button className="choice" key={s.id} onClick={() => setTripStore(s.id)}>
                <b>{s.name}</b>
                <span>
                  {counts(s.id)} {counts(s.id) === 1 ? 'item' : 'items'} on the list
                </span>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {tripSheet && (store !== 'all' || tripStore) && (
        <Sheet
          onClose={() => {
            setTripSheet(false);
            setTripStore(null);
          }}
          labelledBy="trip-title"
          title={
            <h2 id="trip-title" className="sheet-title-plain">
              Start a trip to {storeDef(store === 'all' ? tripStore! : store).name}
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

/** One-tap chips for things you buy regularly that aren't on the list. */
function UsualsRow({ usuals, onPick }: { usuals: Usual[]; onPick: (u: Usual) => void }) {
  if (!usuals.length) return null;
  return (
    <div className="usuals" role="group" aria-label="Usuals: tap to add">
      <span className="usuals-label" aria-hidden="true">
        Usuals
      </span>
      {usuals.map((u) => (
        <button
          type="button"
          key={u.key}
          className="usual"
          onClick={() => onPick(u)}
          aria-label={'Add ' + u.name}
          title={'Last added ' + u.daysSince + (u.daysSince === 1 ? ' day' : ' days') + ' ago'}
        >
          + {u.name}
        </button>
      ))}
    </div>
  );
}

/** Pop-up for adding items, opened by tapping a blank part of the board. */
function AddSheet({
  defaultStore,
  list,
  onAdd,
  usuals,
  onPickUsual,
  onClose,
}: {
  defaultStore: StoreId;
  list: ListId;
  onAdd: (text: string, store: StoreId) => Promise<void>;
  usuals: Usual[];
  onPickUsual: (u: Usual) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState<StoreId>(defaultStore);
  const input = useRef<HTMLInputElement>(null);

  // Takes focus over from the hidden field the tap focused, so the phone keyboard stays up.
  useEffect(() => input.current?.focus(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const value = text;
    onClose();
    await onAdd(value, target);
  }

  const where = list === 'grocery' ? 'Grocery' : 'Nice-to-have';
  return (
    <Sheet
      onClose={onClose}
      labelledBy="add-sheet-title"
      title={
        <h2 id="add-sheet-title" className="sheet-title-plain">
          Add to {where}
        </h2>
      }
    >
      <form className="add-sheet" onSubmit={submit}>
        <label htmlFor="add-sheet-input" className="sr-only">
          Items to add
        </label>
        <input
          id="add-sheet-input"
          ref={input}
          className="sheet-name"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={list === 'grocery' ? 'eggs, 2 milk, bread' : 'something nice'}
          autoComplete="off"
          enterKeyHint="done"
          aria-describedby="add-sheet-hint"
        />
        <p className="hint" id="add-sheet-hint">
          Separate items with commas. “2 milk” or “bread x3” sets the quantity.
        </p>
        <UsualsRow usuals={usuals} onPick={onPickUsual} />
        <div className="segmented small" role="group" aria-label="Store">
          {STORES.map((s) => (
            <button
              type="button"
              key={s.id}
              aria-pressed={target === s.id}
              onClick={() => setTarget(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="sheet-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!text.trim()}>
            Add
          </button>
        </div>
      </form>
    </Sheet>
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
