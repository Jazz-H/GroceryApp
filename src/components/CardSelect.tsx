import { useState } from 'react';
import type { KnownCard } from '../lib/receipts';

/**
 * Picks the card that paid: one seen on earlier receipts, "Unknown", or a new one typed in
 * (name + last 4 digits only).
 */
export function CardSelect({
  id,
  cards,
  value,
  valueName,
  onChange,
}: {
  id: string;
  cards: KnownCard[];
  /** Last 4 of the chosen card, or "" for unknown. */
  value: string;
  /** Name of the chosen card, when it may not be in `cards` yet. */
  valueName?: string;
  onChange: (card: Pick<KnownCard, 'card' | 'last4'> | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [last4, setLast4] = useState('');
  const known = cards.some((c) => c.last4 === value);
  // A card on this receipt that isn't in the list yet (e.g. just read from a photo).
  const options =
    value && !known
      ? [{ last4: value, card: valueName || 'Card', owner: null, count: 0 }, ...cards]
      : cards;

  if (adding)
    return (
      <span className="card-new">
        <input
          aria-label="Card name"
          placeholder="Card name, e.g. Visa"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          aria-label="Last 4 digits"
          className="mono"
          inputMode="numeric"
          placeholder="Last 4"
          maxLength={4}
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
        />
        <button
          type="button"
          className="btn small primary"
          disabled={last4.length !== 4}
          onClick={() => {
            onChange({ card: name.trim() || 'Card', last4 });
            setAdding(false);
          }}
        >
          Use
        </button>
        <button type="button" className="btn small ghost" onClick={() => setAdding(false)}>
          Cancel
        </button>
      </span>
    );

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => {
        if (e.target.value === '+') return setAdding(true);
        const c = options.find((o) => o.last4 === e.target.value);
        onChange(c ? { card: c.card, last4: c.last4 } : null);
      }}
    >
      <option value="">Unknown</option>
      {options.map((c) => (
        <option key={c.last4} value={c.last4}>
          {c.card} •{c.last4}
        </option>
      ))}
      <option value="+">Another card…</option>
    </select>
  );
}
