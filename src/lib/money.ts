import type { Paise } from './types';

export function toPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

export function toRupees(paise: Paise): number {
  return paise / 100;
}

const inrWhole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inrFrac = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹1,23,456 — drops paise when they're zero. */
export function formatINR(paise: Paise, { sign = false }: { sign?: boolean } = {}): string {
  const abs = Math.abs(paise);
  const body = abs % 100 === 0 ? inrWhole.format(abs / 100) : inrFrac.format(abs / 100);
  const prefix = paise < 0 ? '−' : sign && paise > 0 ? '+' : '';
  return `${prefix}₹${body}`;
}

/**
 * Split an amount across `ids` as evenly as possible. Leftover paise go to the
 * first ids in sorted order so every device computes the same result.
 */
export function splitEvenly(amount: Paise, ids: string[]): Map<string, Paise> {
  const out = new Map<string, Paise>();
  if (ids.length === 0) return out;
  const sorted = [...new Set(ids)].sort();
  const base = Math.floor(amount / sorted.length);
  let remainder = amount - base * sorted.length;
  for (const id of sorted) {
    out.set(id, base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder--;
  }
  return out;
}

/** Parse a user-typed rupee amount ("1,200", "450.5") into paise. */
export function parseRupeeInput(value: string): Paise | null {
  const cleaned = value.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? toPaise(n) : null;
}
