import type { Expense, Member, Paise, Payment } from './types';
import { splitEvenly } from './money';

/** Positive = the member is owed money; negative = the member owes. */
export type BalanceMap = Record<string, Paise>;

export interface Transfer {
  from: string;
  to: string;
  amount: Paise;
}

export interface MemberSummary {
  memberId: string;
  /** Total this member paid out for the group. */
  paid: Paise;
  /** This member's share of all resolved expenses. */
  share: Paise;
  net: Paise;
}

export function isCountable(e: Expense): boolean {
  return e.deletedAt === null && e.status === 'resolved' && e.amount !== null && e.amount > 0 && e.paidBy !== null;
}

/** Who an expense is split across, resolved against the current member list. */
export function beneficiariesOf(e: Expense, members: Member[]): string[] {
  const ids = new Set(members.map((m) => m.id));
  if (e.splitAll) return members.map((m) => m.id);
  return e.splitMemberIds.filter((id) => ids.has(id));
}

export function computeSummaries(members: Member[], expenses: Expense[], payments: Payment[]): MemberSummary[] {
  const paid: BalanceMap = {};
  const share: BalanceMap = {};
  const settled: BalanceMap = {};
  for (const m of members) {
    paid[m.id] = 0;
    share[m.id] = 0;
    settled[m.id] = 0;
  }
  for (const e of expenses) {
    if (!isCountable(e) || !(e.paidBy! in paid)) continue;
    const who = beneficiariesOf(e, members);
    if (who.length === 0) continue;
    paid[e.paidBy!] += e.amount!;
    for (const [id, part] of splitEvenly(e.amount!, who)) share[id] += part;
  }
  for (const p of payments) {
    if (p.deletedAt !== null || !(p.fromId in settled) || !(p.toId in settled)) continue;
    settled[p.fromId] += p.amount; // paying back reduces what you owe
    settled[p.toId] -= p.amount; // receiving reduces what you're owed
  }
  return members.map((m) => ({
    memberId: m.id,
    paid: paid[m.id],
    share: share[m.id],
    net: paid[m.id] - share[m.id] + settled[m.id],
  }));
}

export function computeBalances(members: Member[], expenses: Expense[], payments: Payment[]): BalanceMap {
  return Object.fromEntries(computeSummaries(members, expenses, payments).map((s) => [s.memberId, s.net]));
}

/**
 * Greedy debt minimisation: repeatedly match the largest debtor with the
 * largest creditor. Produces at most n−1 transfers. Works in integer paise so
 * the transfers always sum exactly to the balances.
 */
export function simplifyDebts(balances: BalanceMap): Transfer[] {
  const debtors = Object.entries(balances)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, amount: -v }));
  const creditors = Object.entries(balances)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, amount: v }));
  const byAmount = (a: { id: string; amount: number }, b: { id: string; amount: number }) =>
    b.amount - a.amount || a.id.localeCompare(b.id);
  debtors.sort(byAmount);
  creditors.sort(byAmount);

  const transfers: Transfer[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(debtors[d].amount, creditors[c].amount);
    if (amount > 0) transfers.push({ from: debtors[d].id, to: creditors[c].id, amount });
    debtors[d].amount -= amount;
    creditors[c].amount -= amount;
    if (debtors[d].amount === 0) d++;
    if (creditors[c].amount === 0) c++;
  }
  return transfers;
}

export function totalSpend(expenses: Expense[]): Paise {
  return expenses.filter(isCountable).reduce((sum, e) => sum + e.amount!, 0);
}
