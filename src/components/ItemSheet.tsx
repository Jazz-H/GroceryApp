import { useMemo, useState } from 'react';
import { useReceipts } from '../data/hooks';
import { deleteItems, saveItem } from '../data/items';
import { timeAgo } from '../lib/activity';
import { CATEGORIES, categoryName, guessCategory, isCategoryId } from '../lib/categories';
import { formatCents, parsePrice } from '../lib/money';
import { latestByStore, priceHistory, priceTrends, receiptStoreName } from '../lib/receipts';
import { PriceChart } from './PriceChart';
import { STORES } from '../lib/stores';
import type { CategoryId, Household, Item, ListId, StoreId, StoreInfo } from '../types';
import { markerStyle, Sheet } from './ui';

interface StoreDraft {
  on: boolean;
  price: string;
  aisle: string;
}

const KIND_LABEL: Record<string, string> = {
  vic: 'VIC price',
  regular: 'Regular price',
  paid: 'Paid, from a receipt',
  manual: 'Typed in',
};

function draftFor(item: Item, store: StoreId): StoreDraft {
  const info = item.storeInfo[store];
  return {
    on: item.stores.includes(store),
    price: info?.price ? (info.price.cents / 100).toFixed(2) : '',
    aisle: info?.aisle?.label ?? '',
  };
}

export function ItemSheet({
  item,
  household,
  uid,
  focusStore,
  onRemove,
  onClose,
}: {
  item: Item;
  household: Household;
  uid: string;
  focusStore: StoreId;
  /** Removes with an Undo window. Without it the item is deleted straight away. */
  onRemove?: (item: Item) => void;
  onClose: () => void;
}) {
  const receipts = useReceipts(household.id);
  const allPoints = useMemo(() => priceHistory(receipts, item, 60), [receipts, item]);
  const history = allPoints.slice(0, 8);
  const trends = useMemo(() => priceTrends(allPoints), [allPoints]);
  const best = latestByStore(history);
  const [name, setName] = useState(item.name);
  const [qty, setQty] = useState(item.qty);
  const [note, setNote] = useState(item.note);
  const [list, setList] = useState<ListId>(item.list);
  const [main, setMain] = useState<StoreId>(item.stores[0]);
  // '' means "let the app guess from the name".
  const [category, setCategory] = useState<CategoryId | ''>(item.category ?? '');
  const [substitute, setSubstitute] = useState(item.substitute ?? '');
  const [drafts, setDrafts] = useState<Record<StoreId, StoreDraft>>(
    () =>
      Object.fromEntries(STORES.map((s) => [s.id, draftFor(item, s.id)])) as Record<
        StoreId,
        StoreDraft
      >,
  );
  const [error, setError] = useState<string | null>(null);
  // An error is about what was on screen when Save was tapped. Any edit clears it.
  const [errorFor, setErrorFor] = useState<unknown[]>([]);
  const fields = [name, qty, note, list, main, drafts, category, substitute];
  if (error && fields.some((f, i) => f !== errorFor[i])) {
    setError(null);
  }
  const fail = (message: string) => {
    setErrorFor(fields);
    setError(message);
  };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const author = household.members[item.createdBy];
  const color = author?.color;

  function patch(store: StoreId, p: Partial<StoreDraft>) {
    setDrafts((d) => {
      const next = { ...d, [store]: { ...d[store], ...p } };
      // Typing a price or aisle for a store adds the item to that store.
      if ((p.price || p.aisle) && !d[store].on) next[store].on = true;
      return next;
    });
  }

  async function save() {
    const stores = STORES.map((s) => s.id).filter((id) => drafts[id].on);
    if (!stores.length) return fail('Pick at least one store.');
    if (!name.trim()) return fail('The item needs a name.');
    const ordered: StoreId[] = stores.includes(main)
      ? [main, ...stores.filter((s) => s !== main)]
      : stores;
    const storeInfo: Partial<Record<StoreId, StoreInfo>> = {};
    for (const id of ordered) {
      const d = drafts[id];
      const before = item.storeInfo[id];
      const info: StoreInfo = {};
      if (d.price.trim()) {
        const cents = parsePrice(d.price);
        if (cents == null)
          return fail(
            `Check the ${STORES.find((s) => s.id === id)!.name} price. Use a number like 3.99.`,
          );
        info.price =
          before?.price?.cents === cents ? before.price : { cents, kind: 'manual', at: Date.now() };
      }
      if (d.aisle.trim()) {
        const label = d.aisle.trim().slice(0, 30);
        info.aisle = before?.aisle?.label === label ? before.aisle : { label, source: 'manual' };
      }
      storeInfo[id] = info;
    }
    setBusy(true);
    try {
      await saveItem(household.id, uid, item, {
        name,
        qty,
        note,
        stores: ordered,
        storeInfo,
        list,
        category: category || undefined,
        substitute,
      });
      onClose();
    } catch (e) {
      fail(`Couldn’t save: ${(e as Error).message}`);
      setBusy(false);
    }
  }

  async function remove() {
    if (onRemove) onRemove(item);
    else await deleteItems(household.id, uid, [item]);
    onClose();
  }

  return (
    <Sheet
      onClose={onClose}
      labelledBy="item-title"
      title={
        <label htmlFor="item-name" className="sr-only">
          Item name
        </label>
      }
    >
      <input
        id="item-name"
        className="sheet-name marker"
        style={markerStyle(color)}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        aria-labelledby="item-title"
      />
      <p className="sheet-sub" id="item-title">
        Added by {author?.name ?? 'someone'} · {timeAgo(item.createdAt)}
      </p>

      <div className="sheet-row">
        <div className="stepper" role="group" aria-label="Quantity">
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Fewer">
            −
          </button>
          <span className="mono">{qty}</span>
          <button onClick={() => setQty((q) => Math.min(999, q + 1))} aria-label="More">
            +
          </button>
        </div>
        <div className="segmented small" role="group" aria-label="List">
          <button aria-pressed={list === 'grocery'} onClick={() => setList('grocery')}>
            Grocery
          </button>
          <button aria-pressed={list === 'nice'} onClick={() => setList('nice')}>
            Nice-to-have
          </button>
        </div>
      </div>

      <div className="store-grid">
        <div className="store-grid-head" aria-hidden="true">
          <span>Store</span>
          <span>Price (each)</span>
          <span>Aisle</span>
        </div>
        {STORES.map((s) => {
          const d = drafts[s.id];
          const info = item.storeInfo[s.id];
          return (
            <div
              className={`store-line${d.on ? '' : ' off'}${s.id === focusStore ? ' focus' : ''}`}
              key={s.id}
            >
              <label className="store-name" htmlFor={`on-${s.id}`}>
                <input
                  id={`on-${s.id}`}
                  type="checkbox"
                  checked={d.on}
                  onChange={(e) => patch(s.id, { on: e.target.checked })}
                />
                {s.name}
              </label>
              <input
                id={`price-${s.id}`}
                aria-label={`${s.name} price`}
                inputMode="decimal"
                placeholder="Price $"
                value={d.price}
                onChange={(e) => patch(s.id, { price: e.target.value })}
              />
              <input
                id={`aisle-${s.id}`}
                aria-label={`${s.name} aisle`}
                placeholder={s.hasAisles ? 'Aisle (e.g. 7)' : 'No aisles'}
                disabled={!s.hasAisles}
                value={d.aisle}
                onChange={(e) => patch(s.id, { aisle: e.target.value })}
              />
              <span className="store-src">
                {d.on && (
                  <label htmlFor={`main-${s.id}`} className="main-pick">
                    <input
                      id={`main-${s.id}`}
                      type="radio"
                      name="main-store"
                      checked={main === s.id}
                      onChange={() => setMain(s.id)}
                    />
                    Main store
                  </label>
                )}
                {info?.price && (
                  <span>
                    {KIND_LABEL[info.price.kind]} · {formatCents(info.price.cents)} ·{' '}
                    {timeAgo(info.price.at)}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {history.length > 0 && (
        <section className="history" aria-labelledby="history-title">
          <h3 id="history-title" className="label">
            What you’ve paid
          </h3>
          {best.length > 1 && (
            <p className="history-best">
              Cheapest last time: <b>{receiptStoreName(best[0].store)}</b>{' '}
              {formatCents(best[0].unitCents)} (vs {receiptStoreName(best[1].store)}{' '}
              {formatCents(best[1].unitCents)})
            </p>
          )}
          <PriceChart points={allPoints} trends={trends} />
          <ul>
            {history.map((p, i) => (
              <li key={i}>
                <span>{receiptStoreName(p.store)}</span>
                <span className="muted">
                  {new Date(p.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
                <span className="mono">{formatCents(p.unitCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <label htmlFor="item-sub" className="note-label">
        If it’s out, get
        <input
          id="item-sub"
          value={substitute}
          onChange={(e) => setSubstitute(e.target.value)}
          placeholder="e.g. almond milk, or “skip it”"
          maxLength={80}
        />
      </label>

      <label htmlFor="item-category" className="note-label">
        Category
        <select
          id="item-category"
          value={category}
          onChange={(e) => setCategory(isCategoryId(e.target.value) ? e.target.value : '')}
        >
          <option value="">Auto: {categoryName(guessCategory(name))}</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label htmlFor="item-note" className="note-label">
        Note
        <input
          id="item-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Brand, size, “the lactose-free one”"
          maxLength={300}
        />
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="sheet-actions">
        {confirmDelete ? (
          <>
            <span className="muted">Remove {item.name}?</span>
            <button className="btn ghost" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
            <button className="btn danger" onClick={remove}>
              Remove
            </button>
          </>
        ) : (
          <>
            <button className="btn link danger-text" onClick={() => setConfirmDelete(true)}>
              Remove
            </button>
            <span className="spacer" />
            <button className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={save} disabled={busy}>
              Save
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
