import type { StoreId } from '../types';
import { parsePrice } from './money';
import { parseQuickAdd, type QuickAdd } from './text';

export const MAX_IMPORT = 100;

/** Splits one CSV line, honoring double quotes ("Charmin, 24 rolls" stays one field). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function storeFrom(value: string | undefined): StoreId | undefined {
  const v = (value ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!v) return undefined;
  if (v === 'ht' || v.startsWith('harris')) return 'ht';
  if (v === 'tgt' || v.startsWith('target')) return 'target';
  if (v === 'amz' || v.startsWith('amazon')) return 'amazon';
  return undefined;
}

/**
 * Reads pasted text or a CSV file into items to add.
 *
 * - CSV with a header row: columns named name/item, and optionally price, qty/quantity,
 *   store, note. Other columns are ignored.
 * - Otherwise one item per line, like the add box ("2 milk"), with an optional trailing
 *   price ("Bananas, 0.29" or "Bananas $0.29").
 */
export function parseImport(text: string, defaultStore: StoreId): QuickAdd[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const nameCol = col('name', 'item', 'product');
  const out: QuickAdd[] = [];

  if (nameCol >= 0) {
    const priceCol = col('price', 'last_price', 'typical_price', 'unit_price');
    const qtyCol = col('qty', 'quantity');
    const storeCol = col('store');
    const noteCol = col('note', 'notes');
    for (const line of lines.slice(1)) {
      const f = splitCsvLine(line);
      const name = (f[nameCol] ?? '').trim();
      if (!name) continue;
      const priceCents = priceCol >= 0 ? parsePrice(f[priceCol] ?? '') : null;
      const qty = qtyCol >= 0 ? Number(f[qtyCol]) : 1;
      out.push({
        name: name.slice(0, 120),
        qty: Number.isFinite(qty) && qty >= 1 ? Math.round(qty) : 1,
        store: storeFrom(f[storeCol]) ?? defaultStore,
        ...(priceCents != null ? { priceCents, priceKind: 'paid' as const } : {}),
        ...(noteCol >= 0 && f[noteCol] ? { note: f[noteCol] } : {}),
      });
    }
  } else {
    for (const line of lines) {
      const m = /^(.*?)[\s,]+\$?(\d+(?:\.\d{1,2})?)$/.exec(line);
      const hasPrice = m && /[.$,]/.test(line.slice(m[1].length));
      const [entry] = parseQuickAdd(hasPrice ? m![1] : line);
      if (!entry) continue;
      const priceCents = hasPrice ? parsePrice(m![2]) : null;
      out.push({
        ...entry,
        store: defaultStore,
        ...(priceCents != null ? { priceCents, priceKind: 'paid' as const } : {}),
      });
    }
  }
  return out.slice(0, MAX_IMPORT);
}
