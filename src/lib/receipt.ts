/**
 * Pulls total, vendor and date out of OCR text from receipts and app
 * screenshots (Swiggy, Zomato, Uber…). OCR text is noisy, so everything here is
 * a ranked guess with a confidence flag rather than a hard parse.
 */
import type { Paise } from './types';
import { toPaise } from './money';

export interface ReceiptGuess {
  amount: Paise | null;
  /** True when the amount came from a "total"-style line rather than a fallback. */
  amountConfident: boolean;
  vendor: string | null;
  date: string | null; // YYYY-MM-DD
}

const KNOWN_VENDORS = [
  'swiggy', 'zomato', 'zepto', 'blinkit', 'instamart', 'bigbasket', 'dunzo', 'uber', 'ola', 'rapido', 'amazon',
  'flipkart', 'myntra', 'bookmyshow', 'irctc', 'makemytrip', 'starbucks', 'dominos', "domino's", 'mcdonalds',
  "mcdonald's", 'kfc', 'pizza hut', 'subway', 'dmart', 'reliance', 'more', 'spencer', 'nykaa', 'district',
];

// Higher weight wins. Sub-totals and taxes are deliberately low or negative.
const TOTAL_KEYS: [RegExp, number][] = [
  [/grand\s*total/, 10],
  [/(amount|total)\s*(payable|to\s*pay|due)/, 9],
  [/to\s*pay/, 8],
  [/net\s*(amount|payable|total)/, 8],
  [/bill\s*total/, 7],
  [/(total\s*)?paid(\s*via|\s*amount)?/, 6],
  [/order\s*total/, 6],
  [/\btotal\b/, 5],
  [/\bamount\b/, 3],
];
const NOT_TOTAL = /(sub\s*-?\s*total|item\s*total|items?\s*total|savings?|saved|discount|tax|gst|cgst|sgst|delivery\s*fee|packing|tip|mrp|qty|quantity)/;

const AMOUNT_IN_LINE = /(?:₹|rs\.?|inr|z|%|\$)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?!\s*(?:%|gm|g\b|kg|ml|l\b|pcs|items?))/gi;

function amountsIn(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(AMOUNT_IN_LINE)) {
    const n = parseFloat(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0 && n < 1_000_000) out.push(n);
  }
  return out;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toIso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function extractDate(text: string): string | null {
  const t = text.toLowerCase();
  // 12/10/2026, 12-10-26, 12.10.2026 (Indian day-first)
  const dmY = t.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (dmY) {
    const iso = toIso(+dmY[3], +dmY[2], +dmY[1]);
    if (iso) return iso;
  }
  // 2026-10-12
  const iso = t.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return toIso(+iso[1], +iso[2], +iso[3]);
  // 12 Oct 2026 / 12 october, 2026
  const dMonY = t.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*,?\s+(\d{2,4})\b/);
  if (dMonY && MONTHS.includes(dMonY[2])) return toIso(+dMonY[3], MONTHS.indexOf(dMonY[2]) + 1, +dMonY[1]);
  // Oct 12, 2026
  const monDY = t.match(/\b([a-z]{3})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (monDY && MONTHS.includes(monDY[1])) return toIso(+monDY[3], MONTHS.indexOf(monDY[1]) + 1, +monDY[2]);
  return null;
}

export function extractVendor(text: string): string | null {
  const lower = text.toLowerCase();
  for (const v of KNOWN_VENDORS) {
    if (new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\']/g, '\\$&')}\\b`).test(lower)) {
      return v.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
    }
  }
  const skip = /(tax\s*invoice|invoice|receipt|bill|order|gstin|fssai|phone|tel|date|time|www|http|@|^\W*$)/i;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[^a-zA-Z0-9&'.\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    const letters = line.replace(/[^a-zA-Z]/g, '').length;
    if (line.length < 3 || letters < 3 || letters / line.length < 0.6 || skip.test(line)) continue;
    return line.slice(0, 32).replace(/\b([A-Z])([A-Z]+)\b/g, (_, a: string, b: string) => a + b.toLowerCase());
  }
  return null;
}

export function extractTotal(text: string): { amount: Paise | null; confident: boolean } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let best: { value: number; weight: number; line: number } | null = null;
  lines.forEach((line, i) => {
    const lower = line.toLowerCase();
    if (NOT_TOTAL.test(lower) && !/grand\s*total/.test(lower)) return;
    const weight = TOTAL_KEYS.find(([re]) => re.test(lower))?.[1];
    if (!weight) return;
    // The number is usually on the same line; sometimes on the next one.
    let values = amountsIn(line.replace(/\b(20\d{2})\b/g, ''));
    if (!values.length && lines[i + 1]) values = amountsIn(lines[i + 1]);
    if (!values.length) return;
    const value = values[values.length - 1];
    // Prefer higher weight; on a tie prefer the later line (totals sit at the bottom).
    if (!best || weight > best.weight || (weight === best.weight && i > best.line)) best = { value, weight, line: i };
  });
  if (best) return { amount: toPaise((best as { value: number }).value), confident: true };

  // Fallback: the largest currency-marked number, else nothing.
  const marked = [...text.matchAll(/(?:₹|rs\.?|inr)\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi)]
    .map((m) => parseFloat(m[1].replace(/,/g, '')))
    .filter((n) => n > 0 && n < 1_000_000);
  if (marked.length) return { amount: toPaise(Math.max(...marked)), confident: false };
  return { amount: null, confident: false };
}

export function extractReceipt(text: string): ReceiptGuess {
  const { amount, confident } = extractTotal(text);
  return { amount, amountConfident: confident, vendor: extractVendor(text), date: extractDate(text) };
}
