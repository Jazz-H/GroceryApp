import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { saveReceipt } from '../data/receipts';
import { parseReceiptImages, ParseError } from '../data/receiptParser';
import { formatCents, parsePrice } from '../lib/money';
import {
  checkTotals,
  dateToMs,
  fromModel,
  knownCards,
  matchAll,
  msToDate,
  receiptStoreName,
  singlePayment,
  TOLERANCE_CENTS,
  type KnownCard,
  type ReceiptDraft,
} from '../lib/receipts';
import { useReceipts } from '../data/hooks';
import { CardSelect } from './CardSelect';
import type { Household, Item, ReceiptLine, ReceiptStore } from '../types';
import { Sheet } from './ui';

// ---------- Photos with blacked-out boxes ----------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Photo {
  id: string;
  bitmap: ImageBitmap;
  boxes: Box[];
}

/** Longest side sent to Gemini. Receipts are tall, so this keeps small print readable. */
const MAX_SIDE = 2400;

function renderPhoto(photo: Photo, canvas: HTMLCanvasElement, scale: number) {
  const { bitmap, boxes } = photo;
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (const b of boxes)
    ctx.fillRect(b.x * canvas.width, b.y * canvas.height, b.w * canvas.width, b.h * canvas.height);
}

/** Black boxes are burned into the pixels, so the hidden part never leaves the phone. */
function exportPhoto(photo: Photo): string {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, MAX_SIDE / Math.max(photo.bitmap.width, photo.bitmap.height));
  renderPhoto(photo, canvas, scale);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

function PhotoEditor({
  photo,
  onBoxes,
  onRemove,
  index,
}: {
  photo: Photo;
  onBoxes: (boxes: Box[]) => void;
  onRemove: () => void;
  index: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<Box | null>(null);

  useEffect(() => {
    const c = canvas.current;
    const w = wrap.current;
    if (!c || !w) return;
    const { bitmap } = photo;
    const scale = Math.min(
      w.clientWidth / bitmap.width,
      (window.innerHeight * 0.5) / bitmap.height,
      1,
    );
    renderPhoto({ ...photo, boxes: preview ? [...photo.boxes, preview] : photo.boxes }, c, scale);
  }, [photo, preview]);

  function point(e: PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }
  function boxFrom(a: { x: number; y: number }, b: { x: number; y: number }): Box {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    };
  }

  return (
    <figure className="photo">
      <div className="photo-canvas" ref={wrap}>
        <canvas
          ref={canvas}
          aria-label={`Receipt photo ${index + 1}. Drag to black out card or member numbers.`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = point(e);
          }}
          onPointerMove={(e) => drag.current && setPreview(boxFrom(drag.current, point(e)))}
          onPointerUp={(e) => {
            const start = drag.current;
            drag.current = null;
            setPreview(null);
            if (!start) return;
            const box = boxFrom(start, point(e));
            if (box.w > 0.02 && box.h > 0.005) onBoxes([...photo.boxes, box]);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setPreview(null);
          }}
        />
      </div>
      <figcaption className="row-actions">
        <span className="hint">Photo {index + 1}</span>
        <span className="spacer" />
        <button
          className="btn small ghost"
          disabled={!photo.boxes.length}
          onClick={() => onBoxes(photo.boxes.slice(0, -1))}
        >
          Undo box
        </button>
        <button className="btn small ghost" onClick={onRemove}>
          Remove photo
        </button>
      </figcaption>
    </figure>
  );
}

// ---------- Money input that only commits valid amounts ----------

function MoneyInput({
  cents,
  onChange,
  label,
  className,
}: {
  cents: number;
  onChange: (cents: number) => void;
  label: string;
  className?: string;
}) {
  const [text, setText] = useState((cents / 100).toFixed(2));
  useEffect(() => setText((cents / 100).toFixed(2)), [cents]);
  return (
    <input
      className={`mono ${className ?? ''}`}
      aria-label={label}
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const neg = text.trim().startsWith('-');
        const parsed = parsePrice(text.replace('-', ''));
        if (parsed == null) setText((cents / 100).toFixed(2));
        else onChange(neg ? -parsed : parsed);
      }}
    />
  );
}

// ---------- The flow ----------

type Step =
  | { kind: 'photos' }
  | { kind: 'reading' }
  | { kind: 'review'; draft: ReceiptDraft; remembered: Set<number>; error?: string };

export function ReceiptFlow({
  initialStore,
  intro,
  household,
  uid,
  items,
  aliases,
  onClose,
  onSaved,
}: {
  household: Household;
  uid: string;
  items: Item[];
  aliases: Map<string, string>;
  onClose: () => void;
  onSaved: (message: string) => void;
  /** Store to start with, e.g. the trip that just ended. */
  initialStore?: ReceiptStore;
  /** A line shown above the photo step, e.g. "Trip to Harris Teeter finished." */
  intro?: string;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [step, setStep] = useState<Step>({ kind: 'photos' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allReceipts = useReceipts(household.id);
  const cards = useMemo(() => knownCards(allReceipts), [allReceipts]);
  const fileInput = useRef<HTMLInputElement>(null);

  // ImageBitmaps hold decoded image memory and must be closed. Removing a
  // photo closes its own bitmap (see PhotoEditor's onRemove), but anything
  // still open when this flow unmounts has to be closed too.
  //
  // This used to be `useEffect(() => () => photos.forEach(...), [])` with the
  // rule suppressed, which closed nothing at all: the cleanup captured
  // `photos` as it was at mount, and it starts empty. Six full-resolution
  // phone photos is several hundred MB of decoded bitmap leaked per receipt.
  // The ref is read at unmount rather than captured at mount.
  const openPhotos = useRef<Photo[]>([]);
  useEffect(() => {
    openPhotos.current = photos;
  }, [photos]);
  useEffect(() => () => openPhotos.current.forEach((p) => p.bitmap.close()), []);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const added: Photo[] = [];
    for (const file of Array.from(files)) {
      try {
        added.push({ id: crypto.randomUUID(), bitmap: await createImageBitmap(file), boxes: [] });
      } catch {
        setError(`Couldn’t open ${file.name}. Use a JPEG, PNG or screenshot.`);
      }
    }
    setPhotos((p) => [...p, ...added].slice(0, 6));
  }

  async function read() {
    setError(null);
    setStep({ kind: 'reading' });
    try {
      const raw = await parseReceiptImages(photos.map(exportPhoto));
      const parsed = fromModel(raw, uid);
      // A card seen before tells us who usually pays with it.
      const owner = cards.find((c) => c.last4 === parsed.payments?.[0]?.last4)?.owner;
      if (owner && parsed.payments?.length === 1) parsed.paidBy = owner;
      // Trust the store Gemini read, unless it couldn't tell: then use the trip's store.
      if (parsed.store === 'other' && initialStore) parsed.store = initialStore;
      const { draft, remembered } = matchAll(parsed, items, aliases);
      setStep({ kind: 'review', draft, remembered });
    } catch (e) {
      setError(
        e instanceof ParseError ? e.message : `Couldn’t read the receipt: ${(e as Error).message}`,
      );
      setStep({ kind: 'photos' });
    }
  }

  function byHand() {
    // Start at Harris Teeter, your main store, rather than "Other store", where no prices are
    // recorded.
    setStep({
      kind: 'review',
      draft: fromModel({ store: initialStore ?? 'ht' }, uid),
      remembered: new Set(),
    });
  }

  async function save(edited: ReceiptDraft) {
    setBusy(true);
    // One card pays the whole (possibly corrected) total; no payments means unknown.
    const { payments, ...rest } = edited;
    const draft: ReceiptDraft = payments?.length
      ? {
          ...rest,
          payments: payments.length === 1 ? [{ ...payments[0], cents: rest.totalCents }] : payments,
        }
      : rest;
    try {
      const { priced, checked } = await saveReceipt(household.id, uid, draft, items);
      const parts = [`Saved ${formatCents(draft.totalCents)} at ${receiptStoreName(draft.store)}`];
      if (priced) parts.push(`${priced} price${priced === 1 ? '' : 's'} updated`);
      if (checked) parts.push(`${checked} checked off`);
      onSaved(parts.join(' · '));
      onClose();
    } catch (e) {
      setBusy(false);
      if (step.kind === 'review')
        setStep({ ...step, error: `Couldn’t save: ${(e as Error).message}` });
    }
  }

  return (
    <Sheet
      onClose={onClose}
      labelledBy="receipt-title"
      title={
        <h2 id="receipt-title" className="sheet-title-plain">
          {step.kind === 'review' ? 'Check the receipt' : 'Add a receipt'}
        </h2>
      }
    >
      {step.kind === 'photos' && (
        <>
          {intro && <p className="receipt-intro">{intro}</p>}
          <p className="muted">
            Take a photo of a paper receipt, or pick screenshots of a Target or Amazon order. Use
            several photos for a long receipt, top to bottom.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {photos.length > 0 && (
            <p className="privacy">
              <b>Hide anything private:</b> drag across a member number or anything else you don’t
              want sent to Google. The black box is burned into the photo before it leaves your
              phone. Receipts only print a card’s last 4 digits; Stocked keeps those so you can see
              which card paid.
            </p>
          )}
          {photos.map((p, i) => (
            <PhotoEditor
              key={p.id}
              photo={p}
              index={i}
              onBoxes={(boxes) =>
                setPhotos((all) => all.map((x) => (x.id === p.id ? { ...x, boxes } : x)))
              }
              onRemove={() => {
                p.bitmap.close();
                setPhotos((all) => all.filter((x) => x.id !== p.id));
              }}
            />
          ))}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="sheet-actions">
            <button className="btn link" onClick={byHand}>
              Type it in instead
            </button>
            <span className="spacer" />
            <button
              className={`btn ${photos.length ? 'ghost' : 'primary'}`}
              onClick={() => fileInput.current?.click()}
              disabled={photos.length >= 6}
            >
              {photos.length ? 'Add another photo' : 'Choose photo'}
            </button>
            {photos.length > 0 && (
              <button className="btn primary" onClick={read}>
                Read receipt
              </button>
            )}
          </div>
        </>
      )}

      {step.kind === 'reading' && (
        <div className="reading" role="status">
          <div className="spinner" aria-hidden="true" />
          <p>Reading the receipt…</p>
          <p className="hint">This usually takes 5 to 15 seconds.</p>
        </div>
      )}

      {step.kind === 'review' && (
        <Review
          household={household}
          items={items}
          cards={cards}
          draft={step.draft}
          remembered={step.remembered}
          error={step.error}
          busy={busy}
          onChange={(draft) => setStep({ ...step, draft, error: undefined })}
          onCancel={onClose}
          onSave={save}
        />
      )}
    </Sheet>
  );
}

const STORE_OPTIONS: ReceiptStore[] = ['ht', 'target', 'amazon', 'other'];

function Review({
  household,
  items,
  cards,
  draft,
  remembered,
  error,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  household: Household;
  items: Item[];
  cards: KnownCard[];
  draft: ReceiptDraft;
  remembered: Set<number>;
  error?: string;
  busy: boolean;
  onChange: (d: ReceiptDraft) => void;
  onCancel: () => void;
  onSave: (d: ReceiptDraft) => void;
}) {
  const check = checkTotals(draft);
  const set = (p: Partial<ReceiptDraft>) => onChange({ ...draft, ...p });
  const setLine = (i: number, p: Partial<ReceiptLine>) =>
    set({ lines: draft.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });

  // Open items first, then the rest, each alphabetical.
  const options = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          Number(b.status === 'open') - Number(a.status === 'open') || a.name.localeCompare(b.name),
      ),
    [items],
  );
  const matchedCount = draft.lines.filter((l) => l.itemId).length;

  return (
    <>
      <div className="receipt-head">
        <label>
          Store
          <select
            value={draft.store}
            onChange={(e) => set({ store: e.target.value as ReceiptStore })}
          >
            {STORE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {receiptStoreName(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input
            type="date"
            value={msToDate(draft.purchasedAt)}
            onChange={(e) => {
              const ms = dateToMs(e.target.value);
              if (ms) set({ purchasedAt: ms });
            }}
          />
        </label>
        <label>
          Paid by
          <select value={draft.paidBy} onChange={(e) => set({ paidBy: e.target.value })}>
            {household.memberIds.map((id) => (
              <option key={id} value={id}>
                {household.members[id]?.name ?? 'Member'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Card
          {(draft.payments?.length ?? 0) > 1 ? (
            <span className="mono">
              {draft.payments!.map((p) => `•${p.last4 || p.card}`).join(' + ')}
            </span>
          ) : (
            <CardSelect
              id="receipt-card"
              cards={cards}
              value={draft.payments?.[0]?.last4 ?? ''}
              valueName={draft.payments?.[0]?.card}
              onChange={(c) => {
                const owner = c && cards.find((k) => k.last4 === c.last4)?.owner;
                set({
                  payments: singlePayment(c, draft.totalCents),
                  ...(owner ? { paidBy: owner } : {}),
                });
              }}
            />
          )}
        </label>
      </div>

      <div className={`totals-check ${check.ok ? 'ok' : 'warn'}`} role="status">
        {check.ok ? (
          <>
            ✓ Adds up: {draft.lines.length} lines {formatCents(check.linesCents)}
            {draft.taxCents ? ` + tax ${formatCents(draft.taxCents)}` : ''} ={' '}
            {formatCents(draft.totalCents)}
          </>
        ) : draft.lines.length === 0 ? (
          <>Add the lines from the receipt, then the tax and total.</>
        ) : check.linesCents <= 0 ? (
          <>Enter what each line cost, then the total from the bottom of the receipt.</>
        ) : draft.totalCents <= 0 ? (
          <>Enter the total from the bottom of the receipt.</>
        ) : (
          <>
            Doesn’t add up yet.
            {Math.abs(check.subtotalGap) > TOLERANCE_CENTS &&
              ` The lines come to ${formatCents(check.linesCents)}, ${formatCents(Math.abs(check.subtotalGap))} ${check.subtotalGap > 0 ? 'more' : 'less'} than the subtotal: a line may be missing or misread.`}
            {Math.abs(check.totalGap) > TOLERANCE_CENTS &&
              ` Subtotal plus tax is ${formatCents(Math.abs(check.totalGap))} ${check.totalGap > 0 ? 'more' : 'less'} than the total.`}{' '}
            You can still save it.
          </>
        )}
      </div>

      <div className="rlines">
        <div className="rline rline-head" aria-hidden="true">
          <span>Item</span>
          <span>Qty</span>
          <span>Paid</span>
        </div>
        {draft.lines.map((l, i) => (
          <div className={`rline${l.itemId ? ' matched' : ''}`} key={i}>
            <input
              aria-label={`Line ${i + 1} name`}
              value={l.name}
              onChange={(e) => setLine(i, { name: e.target.value })}
            />
            <input
              aria-label={`Line ${i + 1} quantity`}
              className="mono"
              inputMode="numeric"
              value={l.qty}
              onChange={(e) =>
                setLine(i, { qty: Math.min(999, Math.max(1, Number(e.target.value) || 1)) })
              }
            />
            <MoneyInput
              label={`Line ${i + 1} price`}
              cents={l.cents}
              onChange={(cents) => setLine(i, { cents })}
            />
            <div className="rline-sub">
              {l.raw && l.raw !== l.name && <code>{l.raw}</code>}
              <label className="rline-match">
                <span className="sr-only">Line {i + 1} matches list item</span>
                <span aria-hidden="true">→</span>
                <select
                  value={l.itemId ?? ''}
                  onChange={(e) => setLine(i, { itemId: e.target.value || null })}
                >
                  <option value="">Not on our list</option>
                  {options.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                      {it.status === 'open' ? '' : ' (checked)'}
                    </option>
                  ))}
                </select>
                {remembered.has(i) && l.itemId && <span className="tag">remembered</span>}
              </label>
              <button
                className="rline-x"
                onClick={() => set({ lines: draft.lines.filter((_, j) => j !== i) })}
                aria-label={`Remove line ${i + 1}`}
                title="Remove line"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        <button
          className="btn small ghost add-line"
          onClick={() =>
            set({ lines: [...draft.lines, { raw: '', name: '', qty: 1, cents: 0, itemId: null }] })
          }
        >
          + Add line
        </button>
      </div>

      <div className="receipt-sums">
        <label>
          Subtotal
          <MoneyInput
            label="Subtotal"
            cents={draft.subtotalCents}
            onChange={(c) => set({ subtotalCents: c })}
          />
        </label>
        <label>
          Tax
          <MoneyInput label="Tax" cents={draft.taxCents} onChange={(c) => set({ taxCents: c })} />
        </label>
        <label>
          Saved
          <MoneyInput
            label="Savings"
            cents={draft.savingsCents}
            onChange={(c) => set({ savingsCents: Math.abs(c) })}
          />
        </label>
        <label>
          Total
          <MoneyInput
            label="Total"
            className="strong"
            cents={draft.totalCents}
            onChange={(c) => set({ totalCents: c })}
          />
        </label>
      </div>

      <p className={`hint${matchedCount && draft.store === 'other' ? ' store-warn' : ''}`}>
        {!matchedCount
          ? 'Match lines to items on your list to record what you paid and check them off.'
          : draft.store === 'other'
            ? `Prices aren’t saved for “Other store”. Pick Harris Teeter, Target or Amazon above to record what you paid. Saving still checks off the ${matchedCount} matched item${matchedCount === 1 ? '' : 's'}.`
            : `Saving updates the price on ${matchedCount} matched item${matchedCount === 1 ? '' : 's'} at ${receiptStoreName(draft.store)}, checks off any still on the list, and remembers each match for next time.`}
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="sheet-actions">
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn primary"
          onClick={() => onSave(draft)}
          disabled={busy || draft.totalCents <= 0}
        >
          Save receipt
        </button>
      </div>
    </>
  );
}
