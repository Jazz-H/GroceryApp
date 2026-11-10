import type { Receipt } from '../types';
import { fromModel, monthKey, type ReceiptDraft } from './receipts';

/**
 * Receipt links carry past receipts after "#receipts=" as base64url JSON, so they never reach
 * a server. Each receipt uses the same shape as the Gemini reader's answer (dollars), so
 * fromModel() validates and converts it.
 */
export const MAX_LINK_RECEIPTS = 40;

function toB64url(text: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(b64url: string): string | null {
  try {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

export function encodeReceiptsLink(origin: string, receipts: unknown[]): string {
  return `${origin}/#receipts=${toB64url(JSON.stringify(receipts))}`;
}

/** Drafts from a "#receipts=" hash, or null when the hash isn't a valid receipt link. */
export function decodeReceiptsHash(hash: string, paidBy: string): ReceiptDraft[] | null {
  const m = /^#?receipts=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  const json = fromB64url(m[1]);
  if (json == null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  const drafts = raw
    .slice(0, MAX_LINK_RECEIPTS)
    .map((r) => fromModel(r, paidBy))
    .filter((d) => d.totalCents > 0);
  return drafts.length ? drafts : null;
}

/** True when a receipt for the same store, day and total is already saved. */
export function isDuplicate(draft: ReceiptDraft, existing: Receipt[]): boolean {
  const day = new Date(draft.purchasedAt).toDateString();
  return existing.some(
    (r) =>
      r.store === draft.store &&
      Math.abs(r.totalCents - draft.totalCents) <= 1 &&
      new Date(r.purchasedAt).toDateString() === day,
  );
}

/** "November 2026" style list of months a set of drafts covers, for the confirm card. */
export function draftMonths(drafts: ReceiptDraft[]): string[] {
  return [...new Set(drafts.map((d) => monthKey(d.purchasedAt)))].sort();
}
