import type { Receipt, Settlement } from '../types';

export interface Balance {
  /** Per member: what they paid minus their equal share, after settlements. Sums to ~0. */
  net: Record<string, number>;
  /** Who owes whom to even things out (two members: at most one transfer). */
  transfers: { from: string; to: string; cents: number }[];
  /** Spending counted, for context. */
  totalCents: number;
}

/**
 * Shared spending split equally among the current members. Each receipt counts for whoever
 * paid it; each settlement moves money from one member to another. Receipts paid by someone
 * who is no longer a member are left out.
 */
export function balances(
  receipts: Receipt[],
  settlements: Settlement[],
  memberIds: string[],
): Balance {
  const net: Record<string, number> = Object.fromEntries(memberIds.map((id) => [id, 0]));
  if (memberIds.length < 2) return { net, transfers: [], totalCents: 0 };
  let total = 0;
  for (const r of receipts) {
    if (!(r.paidBy in net) || r.totalCents <= 0) continue;
    total += r.totalCents;
    net[r.paidBy] += r.totalCents;
  }
  const share = total / memberIds.length;
  for (const id of memberIds) net[id] = Math.round(net[id] - share);
  for (const s of settlements) {
    if (!(s.from in net) || !(s.to in net)) continue;
    net[s.from] += s.cents;
    net[s.to] -= s.cents;
  }
  // Greedy: biggest debtor pays biggest creditor until everyone is within a cent.
  const owe = memberIds
    .filter((id) => net[id] < -1)
    .map((id) => ({ id, c: -net[id] }))
    .sort((a, b) => b.c - a.c);
  const get = memberIds
    .filter((id) => net[id] > 1)
    .map((id) => ({ id, c: net[id] }))
    .sort((a, b) => b.c - a.c);
  const transfers: Balance['transfers'] = [];
  while (owe.length && get.length) {
    const c = Math.min(owe[0].c, get[0].c);
    transfers.push({ from: owe[0].id, to: get[0].id, cents: c });
    owe[0].c -= c;
    get[0].c -= c;
    if (owe[0].c <= 1) owe.shift();
    if (get[0].c <= 1) get.shift();
  }
  return { net, transfers, totalCents: total };
}
