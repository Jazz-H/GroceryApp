import { useMemo, useState } from 'react';
import { useAliases, useReceipts } from '../data/hooks';
import { deleteReceipt, setBudget, setReceiptPaidBy } from '../data/receipts';
import { formatCents, parsePrice } from '../lib/money';
import {
  monthKey,
  monthLabel,
  monthTotals,
  receiptStoreName,
  shiftMonth,
  summarizeMonth,
  toCsv,
} from '../lib/receipts';
import type { Household, Item, Receipt } from '../types';
import { ReceiptFlow } from './ReceiptFlow';
import { Avatar, Sheet } from './ui';

export function Spend({
  household,
  uid,
  items,
}: {
  household: Household;
  uid: string;
  items: Item[];
}) {
  const receipts = useReceipts(household.id);
  const aliases = useAliases(household.id);
  const thisMonth = monthKey(Date.now());
  const [month, setMonth] = useState(thisMonth);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Receipt | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const summary = useMemo(() => summarizeMonth(receipts, month), [receipts, month]);
  const previous = useMemo(
    () => summarizeMonth(receipts, shiftMonth(month, -1)),
    [receipts, month],
  );
  const history = useMemo(() => monthTotals(receipts, month, 6), [receipts, month]);
  const inMonth = receipts.filter((r) => monthKey(r.purchasedAt) === month);
  // Headroom above the tallest bar (or the budget line) so the line stays visible.
  const peak = Math.max(1, ...history.map((h) => h.cents), household.budgetCents ?? 0) * 1.15;
  const storeMax = Math.max(1, ...summary.byStore.map((s) => s.cents));

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }

  function exportCsv() {
    const blob = new Blob([toCsv(receipts, household.members)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `stocked-receipts-${thisMonth}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const change = summary.cents - previous.cents;

  return (
    <section className="spend">
      <div className="spend-head">
        <h1 className="screen-title">Spending</h1>
        <button className="btn primary" onClick={() => setAdding(true)}>
          Add receipt
        </button>
      </div>

      <div className="month-nav">
        <button
          className="btn small ghost"
          onClick={() => setMonth(shiftMonth(month, -1))}
          aria-label="Previous month"
        >
          ‹
        </button>
        <span>
          {monthLabel(month)} {month.slice(0, 4) !== thisMonth.slice(0, 4) && month.slice(0, 4)}
        </span>
        <button
          className="btn small ghost"
          onClick={() => setMonth(shiftMonth(month, 1))}
          disabled={month >= thisMonth}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="card spend-total">
        <div className="big">{formatCents(summary.cents)}</div>
        <p className="muted">
          {summary.count} receipt{summary.count === 1 ? '' : 's'}
          {previous.cents > 0 &&
            ` · ${formatCents(Math.abs(change))} ${change >= 0 ? 'more' : 'less'} than ${monthLabel(previous.month)}`}
          {summary.savingsCents > 0 && ` · saved ${formatCents(summary.savingsCents)}`}
        </p>
        <Budget household={household} spent={summary.cents} isCurrent={month === thisMonth} />
      </div>

      {summary.count > 0 && (
        <div className="card">
          <h2>By store</h2>
          <ul className="bars">
            {summary.byStore.map((s) => (
              <li key={s.key}>
                <span className="bar-label">{receiptStoreName(s.key)}</span>
                <span className="bar-track">
                  <span className="bar" style={{ width: `${(s.cents / storeMax) * 100}%` }} />
                </span>
                <span className="mono">{formatCents(s.cents)}</span>
              </li>
            ))}
          </ul>
          {household.memberIds.length > 1 && (
            <>
              <h2>Who paid</h2>
              <ul className="bars">
                {summary.byPerson.map((p) => {
                  const m = household.members[p.key];
                  return (
                    <li key={p.key}>
                      <span className="bar-label">
                        <Avatar member={m} size={18} /> {m?.name ?? 'Former member'}
                      </span>
                      <span className="bar-track">
                        <span
                          className="bar"
                          style={{
                            width: `${(p.cents / summary.cents) * 100}%`,
                            background: m?.color,
                          }}
                        />
                      </span>
                      <span className="mono">{formatCents(p.cents)}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2>Last 6 months</h2>
        <ol className="months" aria-label="Spending by month">
          {history.map((h) => (
            <li key={h.key} aria-current={h.key === month ? 'true' : undefined}>
              <button
                onClick={() => setMonth(h.key)}
                aria-label={`${monthLabel(h.key)}: ${formatCents(h.cents)}`}
              >
                <span className="col-track">
                  {household.budgetCents && (
                    <span
                      className="col-budget"
                      style={{ bottom: `${(household.budgetCents / peak) * 100}%` }}
                    />
                  )}
                  <span className="col" style={{ height: `${(h.cents / peak) * 100}%` }} />
                </span>
                <span className="col-label">{monthLabel(h.key, 'short')}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="card">
        <h2>Receipts in {monthLabel(month)}</h2>
        {inMonth.length === 0 ? (
          <p className="muted">
            None yet. After a shop, tap <b>Add receipt</b> and take a photo. Prices on your list
            update from what you actually paid.
          </p>
        ) : (
          <ul className="receipts">
            {inMonth.map((r) => (
              <li key={r.id}>
                <button onClick={() => setOpen(r)}>
                  <Avatar member={household.members[r.paidBy]} size={24} />
                  <span className="r-main">
                    <b>{receiptStoreName(r.store)}</b>
                    <span className="hint">
                      {new Date(r.purchasedAt).toLocaleDateString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}{' '}
                      · {r.lines.length} item{r.lines.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="mono">{formatCents(r.totalCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {receipts.length > 0 && (
          <div className="row-actions">
            <button className="btn link" onClick={exportCsv}>
              Export all to CSV
            </button>
          </div>
        )}
      </div>

      {adding && (
        <ReceiptFlow
          household={household}
          uid={uid}
          items={items}
          aliases={aliases}
          onClose={() => setAdding(false)}
          onSaved={(msg) => {
            showToast(msg);
            setMonth(thisMonth);
          }}
        />
      )}
      {open && (
        <ReceiptDetail
          household={household}
          items={items}
          receipt={receipts.find((r) => r.id === open.id) ?? open}
          onClose={() => setOpen(null)}
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

function Budget({
  household,
  spent,
  isCurrent,
}: {
  household: Household;
  spent: number;
  isCurrent: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const budget = household.budgetCents;

  if (editing)
    return (
      <>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const cents = text.trim() ? parsePrice(text) : null;
            if (text.trim() && cents == null)
              return setError('Use a dollar amount like 600. Leave it empty to remove the budget.');
            setError(null);
            setBudget(household, cents);
            setEditing(false);
          }}
        >
          <label htmlFor="budget" className="sr-only">
            Monthly budget in dollars
          </label>
          <input
            id="budget"
            inputMode="decimal"
            autoFocus
            placeholder="Monthly budget, e.g. 600"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'budget-error' : undefined}
          />
          <button className="btn ghost">Save</button>
        </form>
        {error && (
          <p className="error" id="budget-error" role="alert">
            {error}
          </p>
        )}
      </>
    );

  if (!budget)
    return (
      <button className="btn link budget-set" onClick={() => setEditing(true)}>
        Set a monthly budget
      </button>
    );

  const pct = spent / budget;
  const left = budget - spent;
  const state = pct >= 1 ? 'over' : pct >= 0.8 ? 'near' : 'ok';
  return (
    <div className={`budget ${state}`}>
      <div
        className="meter"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={spent}
        aria-label="Budget used"
      >
        <span style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      <p>
        {left >= 0
          ? `${formatCents(left)} left of ${formatCents(budget)}`
          : `${formatCents(-left)} over the ${formatCents(budget)} budget`}
        {isCurrent && state === 'near' && ' · getting close'}{' '}
        <button
          className="btn link"
          onClick={() => {
            setText((budget / 100).toFixed(0));
            setEditing(true);
          }}
        >
          Change
        </button>
      </p>
    </div>
  );
}

function ReceiptDetail({
  household,
  items,
  receipt,
  onClose,
}: {
  household: Household;
  items: Item[];
  receipt: Receipt;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const names = new Map(items.map((i) => [i.id, i.name]));
  return (
    <Sheet
      onClose={onClose}
      labelledBy="rd-title"
      title={
        <h2 id="rd-title" className="sheet-title-plain">
          {receiptStoreName(receipt.store)} ·{' '}
          {new Date(receipt.purchasedAt).toLocaleDateString(undefined, {
            month: 'long',
            day: 'numeric',
          })}
        </h2>
      }
    >
      <label className="note-label">
        Paid by
        <select
          value={receipt.paidBy}
          onChange={(e) => setReceiptPaidBy(household.id, receipt, e.target.value)}
        >
          {household.memberIds.map((id) => (
            <option key={id} value={id}>
              {household.members[id]?.name ?? 'Member'}
            </option>
          ))}
        </select>
      </label>
      <ul className="rd-lines">
        {receipt.lines.map((l, i) => (
          <li key={i}>
            <span>
              {l.qty > 1 && <span className="mono">{l.qty}× </span>}
              {l.name || l.raw}
              {l.itemId && names.has(l.itemId) && names.get(l.itemId) !== l.name && (
                <span className="hint"> → {names.get(l.itemId)}</span>
              )}
            </span>
            <span className="mono">{formatCents(l.cents)}</span>
          </li>
        ))}
        {receipt.taxCents > 0 && (
          <li className="muted">
            <span>Tax</span>
            <span className="mono">{formatCents(receipt.taxCents)}</span>
          </li>
        )}
        <li className="rd-total">
          <span>Total</span>
          <span className="mono">{formatCents(receipt.totalCents)}</span>
        </li>
      </ul>
      {receipt.savingsCents > 0 && (
        <p className="hint">Saved {formatCents(receipt.savingsCents)} with discounts.</p>
      )}
      <div className="sheet-actions">
        {confirm ? (
          <>
            <span className="muted">Remove this receipt from spending?</span>
            <button className="btn ghost" onClick={() => setConfirm(false)}>
              Keep
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                await deleteReceipt(household.id, receipt);
                onClose();
              }}
            >
              Remove
            </button>
          </>
        ) : (
          <>
            <button className="btn link danger-text" onClick={() => setConfirm(true)}>
              Remove receipt
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
