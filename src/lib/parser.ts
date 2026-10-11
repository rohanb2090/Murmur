/**
 * Deterministic expense parser for Murmur.
 *
 * Turns free text from voice, OCR or the scratchpad ("auto 140 kabir",
 * "rohan paid 1,200 for dinner split with kabir and meera") into a structured
 * expense. No network, no LLM. When the parser isn't sure it says so via
 * `confidence` + `issues` and the entry is saved as `unresolved` instead of
 * failing — capture must never be blocked.
 */
import type { Paise } from './types';
import { toPaise, formatINR } from './money';

export interface ParserMember {
  id: string;
  name: string;
  aliases?: string[];
}

export interface ParsedExpense {
  amount: Paise | null;
  paidBy: string | null;
  splitAll: boolean;
  splitMemberIds: string[];
  description: string;
  confidence: number;
  status: 'resolved' | 'unresolved';
  issues: string[];
}

export const CONFIDENCE_THRESHOLD = 0.8;

const CURRENCY_BEFORE = new Set(['₹', 'rs', 'inr', 'rupees', 'rupee']);
const CURRENCY_AFTER = new Set(['rupees', 'rupee', 'rs', 'bucks', 'inr', 'rupaye', 'rupaiye', 'rupay']);
const MULTIPLIERS: Record<string, number> = { k: 1_000, thousand: 1_000, hazaar: 1_000, hazar: 1_000, lakh: 100_000, lakhs: 100_000, lac: 100_000 };
const HEADCOUNT_AFTER = new Set(['people', 'persons', 'person', 'ways', 'way', 'log', 'members', 'friends', 'guys', 'of', 'nights', 'night', 'days', 'day', 'pm', 'am', 'baje', 'percent', '%']);
const SELF_WORDS = new Set(['i', 'me', 'myself', 'maine', 'mujhe', 'mera', 'mere', 'my', "i've", 'im']);
const ALL_WORDS = new Set(['all', 'everyone', 'everybody', 'sab', 'sabka', 'sabke', 'sabhi', 'group', 'everyones']);
const PAID_WORDS = new Set(['paid', 'pays', 'pay', 'payed', 'diya', 'diye', 'kiya', 'bhara', 'covered', 'spent', 'gave']);
const LIST_JOINERS = new Set(['and', 'aur', '&', 'n', 'plus', 'also']);
const SPLIT_INCLUSIVE = new Set(['with', 'saath', 'sath']);
const SPLIT_EXACT = new Set(['between', 'among', 'amongst', 'for']);
const FILLER = new Set([
  'split', 'splitting', 'by', 'ne', 'the', 'a', 'an', 'of', 'on', 'is', 'was', 'it', 'and', 'aur', 'us',
  'equally', 'evenly', 'just', 'only', 'ka', 'ke', 'ki', 'ko', 'hai', 'tha', 'per', 'each', 'total', 'amount',
  'has', 'had', 'have', 'we', 'our', 'in', 'at', 'so', 'k', 'thousand', 'lakh', 'lakhs', 'lac', 'hazaar', 'hazar',
  'ways', 'way', 'people', 'persons', 'log', '&', 'n', 'plus', 'also', 'saath', 'sath', 'ji',
]);

interface Token {
  text: string;
  index: number;
}

interface Mention {
  memberId: string;
  start: number;
  end: number; // inclusive token index
  self: boolean;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/(\d)\s*,\s*(?=\d)/g, '$1') // 1,200 and Indian 1,20,000
    .replace(/\/-/g, ' rupees ')
    .replace(/₹/g, ' ₹ ')
    .replace(/\brs\.(?=\s|\d)/g, 'rs ')
    .replace(/(\d)(k|rs|inr)\b/g, '$1 $2');
}

function tokenize(text: string): Token[] {
  const raw = normalise(text).match(/₹|\d+(?:\.\d+)?|[a-zऀ-ॿ]+(?:'[a-z]+)?|&|%/g) ?? [];
  return raw.map((t, index) => ({ text: t.replace(/'s$/, ''), index }));
}

function isNumber(t: string | undefined): boolean {
  return t !== undefined && /^\d+(?:\.\d+)?$/.test(t);
}

interface AmountCandidate {
  value: number;
  tokenIdxs: number[];
  marked: boolean;
}

function findAmount(tokens: Token[]): { candidates: AmountCandidate[]; consumed: Set<number> } {
  const candidates: AmountCandidate[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].text;
    if (!isNumber(t)) continue;
    let value = parseFloat(t);
    const idxs = [i];
    let next = i + 1;
    const mult = MULTIPLIERS[tokens[next]?.text ?? ''];
    if (mult) {
      value *= mult;
      idxs.push(next);
      next++;
    }
    const prev = tokens[i - 1]?.text;
    const after = tokens[next]?.text;
    const marked = (prev !== undefined && CURRENCY_BEFORE.has(prev)) || (after !== undefined && CURRENCY_AFTER.has(after));
    if (prev !== undefined && CURRENCY_BEFORE.has(prev)) idxs.push(i - 1);
    if (after !== undefined && CURRENCY_AFTER.has(after)) idxs.push(next);
    const headcount =
      !marked &&
      ((after !== undefined && HEADCOUNT_AFTER.has(after)) || prev === 'between' || prev === 'among' || prev === 'x' || prev === 'into');
    idxs.forEach((x) => consumed.add(x));
    if (headcount || value <= 0 || value >= 10_000_000) continue;
    candidates.push({ value, tokenIdxs: idxs, marked });
  }
  return { candidates, consumed };
}

function buildNameIndex(members: ParserMember[]): { words: string[]; memberId: string }[] {
  const entries: { words: string[]; memberId: string }[] = [];
  for (const m of members) {
    const names = new Set<string>();
    const full = m.name.trim().toLowerCase();
    if (full) {
      names.add(full);
      const first = full.split(/\s+/)[0];
      if (first.length >= 2) names.add(first);
    }
    for (const a of m.aliases ?? []) if (a.trim()) names.add(a.trim().toLowerCase());
    for (const n of names) {
      const words = n.match(/[a-zऀ-ॿ]+/g);
      if (words?.length) entries.push({ words, memberId: m.id });
    }
  }
  // Longest names first so "kabir singh" wins over "kabir".
  return entries.sort((a, b) => b.words.length - a.words.length);
}

function findMentions(tokens: Token[], members: ParserMember[], meId: string | null): Mention[] {
  const index = buildNameIndex(members);
  const mentions: Mention[] = [];
  const taken = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    if (taken.has(i)) continue;
    for (const entry of index) {
      const n = entry.words.length;
      const slice = tokens.slice(i, i + n).map((t) => t.text);
      if (slice.length === n && slice.every((w, k) => w === entry.words[k])) {
        // A name shared by two members is ambiguous; skip it rather than guess.
        const clash = index.some((e) => e.memberId !== entry.memberId && e.words.join(' ') === entry.words.join(' '));
        if (!clash) {
          mentions.push({ memberId: entry.memberId, start: i, end: i + n - 1, self: false });
          for (let k = i; k < i + n; k++) taken.add(k);
        }
        break;
      }
    }
    if (!taken.has(i) && meId && SELF_WORDS.has(tokens[i].text)) {
      mentions.push({ memberId: meId, start: i, end: i, self: true });
      taken.add(i);
    }
  }
  return mentions;
}

const mentionAt = (mentions: Mention[], idx: number) => mentions.find((m) => m.start === idx);
const mentionEndingAt = (mentions: Mention[], idx: number) => mentions.find((m) => m.end === idx);

/** Read a list like "kabir, meera and me" starting at `start`. */
function readList(tokens: Token[], mentions: Mention[], start: number) {
  const ids: string[] = [];
  const used: number[] = [];
  let all = false;
  let unknown: string | null = null;
  let i = start;
  while (i < tokens.length) {
    const t = tokens[i].text;
    const m = mentionAt(mentions, i);
    if (m) {
      ids.push(m.memberId);
      for (let k = m.start; k <= m.end; k++) used.push(k);
      i = m.end + 1;
      continue;
    }
    if (ALL_WORDS.has(t)) {
      all = true;
      used.push(i);
      i++;
      continue;
    }
    if (LIST_JOINERS.has(t) || t === 'the') {
      used.push(i);
      i++;
      continue;
    }
    if (ids.length === 0 && !all && /^[a-z]{2,}$/.test(t) && !FILLER.has(t) && !isNumber(t)) unknown = t;
    break;
  }
  return { ids, used, all, unknown };
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function parseExpense(text: string, members: ParserMember[], meId: string | null): ParsedExpense {
  const tokens = tokenize(text);
  const issues: string[] = [];
  const usedTokens = new Set<number>();

  // ── 1. Amount ────────────────────────────────────────────────────────────
  const { candidates, consumed } = findAmount(tokens);
  consumed.forEach((i) => usedTokens.add(i));
  let amount: Paise | null = null;
  let amountScore = 0;
  const marked = candidates.filter((c) => c.marked);
  const pool = marked.length ? marked : candidates;
  if (pool.length === 1) {
    amount = toPaise(pool[0].value);
    amountScore = 0.5;
  } else if (pool.length > 1) {
    const distinct = new Set(pool.map((c) => c.value));
    const best = pool.reduce((a, b) => (b.value > a.value ? b : a));
    amount = toPaise(best.value);
    if (distinct.size === 1) amountScore = 0.5;
    else {
      amountScore = 0.25;
      issues.push(`Several amounts heard — picked ${formatINR(amount)}`);
    }
  } else {
    issues.push('No amount found');
  }

  // ── 2. People ────────────────────────────────────────────────────────────
  const mentions = findMentions(tokens, members, meId);
  let paidBy: string | null = null;
  let payerScore = 0;
  let payerMention: Mention | null = null;

  for (let i = 0; i < tokens.length && !paidBy; i++) {
    const t = tokens[i].text;
    if (!PAID_WORDS.has(t)) continue;
    // "paid by kabir"
    if (tokens[i + 1]?.text === 'by') {
      const m = mentionAt(mentions, i + 2);
      if (m) {
        payerMention = m;
        usedTokens.add(i).add(i + 1);
      } else if (tokens[i + 2] && /^[a-z]{2,}$/.test(tokens[i + 2].text)) {
        issues.push(`"${tokens[i + 2].text}" isn't in this room`);
        usedTokens.add(i).add(i + 1).add(i + 2);
        payerScore = -1;
        break;
      }
    }
    // "kabir paid", "kabir ne diya", "kabir has paid", "maine diya"
    if (!payerMention) {
      let j = i - 1;
      while (j >= 0 && ['ne', 'has', 'had', 'just', 'already', 'ji'].includes(tokens[j].text)) j--;
      const m = mentionEndingAt(mentions, j);
      if (m) {
        payerMention = m;
        for (let k = j + 1; k <= i; k++) usedTokens.add(k);
      }
    }
    if (payerMention) paidBy = payerMention.memberId;
  }
  // Hinglish agent marker: "meera ne 300 diya chai".
  if (!paidBy && payerScore === 0) {
    const ne = mentions.find((m) => tokens[m.end + 1]?.text === 'ne');
    if (ne) {
      paidBy = ne.memberId;
      payerMention = ne;
      usedTokens.add(ne.end + 1);
    }
  }
  // "maine 500 diye" / "maine" alone strongly means "I paid".
  if (!paidBy && payerScore === 0) {
    const maine = mentions.find((m) => m.self && tokens[m.start].text === 'maine');
    if (maine) {
      paidBy = maine.memberId;
      payerMention = maine;
    }
  }
  if (paidBy) payerScore = 0.3;
  else if (payerScore === 0 && meId) {
    paidBy = meId;
    payerScore = 0.25;
  } else if (payerScore === 0) {
    issues.push('Who paid?');
  }
  if (payerScore < 0) payerScore = 0;
  if (payerMention) for (let k = payerMention.start; k <= payerMention.end; k++) usedTokens.add(k);

  // ── 3. Split ─────────────────────────────────────────────────────────────
  let splitAll = true;
  let splitIds: string[] = [];
  let splitScore = 0.2;
  let explicitSplit = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].text;
    const inclusive = SPLIT_INCLUSIVE.has(t);
    const exact = SPLIT_EXACT.has(t);
    if (!inclusive && !exact) continue;
    const list = readList(tokens, mentions, i + 1);
    const afterSplitWord = tokens[i - 1]?.text === 'split' || tokens[i - 1]?.text === 'splitting';
    if (list.all) {
      explicitSplit = true;
      splitAll = true;
      [i, ...list.used].forEach((k) => usedTokens.add(k));
      break;
    }
    if (list.ids.length) {
      explicitSplit = true;
      splitAll = false;
      splitIds = inclusive && paidBy ? [paidBy, ...list.ids] : list.ids;
      [i, ...list.used].forEach((k) => usedTokens.add(k));
      break;
    }
    if (list.unknown && afterSplitWord) {
      issues.push(`"${list.unknown}" isn't in this room`);
      splitScore = 0;
      usedTokens.add(i).add(i + 1);
      explicitSplit = true;
      break;
    }
  }

  if (!explicitSplit) {
    const allIdx = tokens.findIndex((t) => ALL_WORDS.has(t.text));
    const stray = mentions.filter((m) => m !== payerMention && !m.self);
    if (allIdx >= 0) {
      usedTokens.add(allIdx);
    } else if (stray.length) {
      // "auto 140 kabir" → shared between the payer and the people named.
      splitAll = false;
      splitIds = paidBy ? [paidBy, ...stray.map((m) => m.memberId)] : stray.map((m) => m.memberId);
      splitScore = 0.15;
      stray.forEach((m) => {
        for (let k = m.start; k <= m.end; k++) usedTokens.add(k);
      });
    }
  }
  splitIds = [...new Set(splitIds)];
  if (!splitAll && splitIds.length === 0) splitAll = true;

  // ── 4. Description: whatever words are left ─────────────────────────────
  mentions.forEach((m) => {
    for (let k = m.start; k <= m.end; k++) usedTokens.add(k);
  });
  const words = tokens
    .filter((t, i) => !usedTokens.has(i) && !isNumber(t.text) && !FILLER.has(t.text) && !PAID_WORDS.has(t.text) && !ALL_WORDS.has(t.text) && !CURRENCY_BEFORE.has(t.text) && !CURRENCY_AFTER.has(t.text) && !SPLIT_EXACT.has(t.text) && !SPLIT_INCLUSIVE.has(t.text) && t.text !== '%')
    .map((t) => t.text);
  let description = words.join(' ').trim();
  if (description.length > 40) description = description.slice(0, 40).replace(/\s+\S*$/, '');
  description = description ? titleCase(description) : 'Expense';

  const confidence = Math.round((amountScore + payerScore + splitScore) * 100) / 100;
  const status = confidence >= CONFIDENCE_THRESHOLD && amount !== null && paidBy !== null ? 'resolved' : 'unresolved';

  return { amount, paidBy, splitAll, splitMemberIds: splitAll ? [] : splitIds, description, confidence, status, issues };
}
