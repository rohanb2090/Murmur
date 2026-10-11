import type { Expense, Member } from './types';
import { formatINR } from './money';

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function memberLabel(id: string | null, members: Member[], meId: string): string {
  if (!id) return '?';
  if (id === meId) return 'You';
  return members.find((m) => m.id === id)?.name.split(/\s+/)[0] ?? 'Someone';
}

/** "₹420 • Paid by You • Split: All (4)" */
export function breakdown(e: Expense, members: Member[], meId: string): string {
  const amount = e.amount === null ? '₹?' : formatINR(e.amount);
  const payer = e.paidBy ? `Paid by ${memberLabel(e.paidBy, members, meId)}` : 'Payer?';
  let split: string;
  if (e.splitAll) split = `Split: All (${members.length})`;
  else {
    const names = e.splitMemberIds.map((id) => memberLabel(id, members, meId));
    split = names.length <= 2 ? `Split: ${names.join(' & ')}` : `Split: ${names.length} people`;
  }
  return `${amount} • ${payer} • ${split}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}
