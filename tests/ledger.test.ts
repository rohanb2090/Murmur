import { describe, expect, it } from 'vitest';
import { computeBalances, simplifyDebts, totalSpend } from '@/lib/ledger';
import { formatINR, parseRupeeInput, splitEvenly } from '@/lib/money';
import { buildUpiUri, isValidUpiId } from '@/lib/upi';
import type { Expense, Member, Payment } from '@/lib/types';

const member = (id: string): Member => ({ id, groupId: 'g', name: id, aliases: [], upiId: null, deviceId: null, createdAt: 0, updatedAt: 0 });
const members = ['a', 'b', 'c', 'd'].map(member);

let n = 0;
const expense = (paidBy: string, amount: number, split: string[] | 'all', extra: Partial<Expense> = {}): Expense => ({
  id: `e${n++}`,
  groupId: 'g',
  rawInput: '',
  captureMode: 'text',
  description: '',
  amount,
  paidBy,
  splitAll: split === 'all',
  splitMemberIds: split === 'all' ? [] : split,
  status: 'resolved',
  issues: [],
  receiptThumb: null,
  createdBy: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  ...extra,
});

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('money', () => {
  it('splits paise exactly, deterministically', () => {
    const parts = splitEvenly(10000, ['c', 'a', 'b']);
    expect(sum([...parts.values()])).toBe(10000);
    expect(parts.get('a')).toBe(3334);
    expect(parts.get('b')).toBe(3333);
  });
  it('formats Indian grouping', () => {
    expect(formatINR(12345600)).toBe('₹1,23,456');
    expect(formatINR(-4550)).toBe('−₹45.50');
    expect(formatINR(500, { sign: true })).toBe('+₹5');
  });
  it('parses typed rupees', () => {
    expect(parseRupeeInput('1,200')).toBe(120000);
    expect(parseRupeeInput('₹45.5')).toBe(4550);
    expect(parseRupeeInput('abc')).toBeNull();
    expect(parseRupeeInput('0')).toBeNull();
  });
});

describe('ledger', () => {
  it('balances always sum to zero and skip unresolved/deleted entries', () => {
    const ex = [
      expense('a', 100000, 'all'),
      expense('b', 33333, ['a', 'b', 'c']),
      expense('c', 99999, ['d']),
      expense('d', 50000, 'all', { status: 'unresolved' }),
      expense('d', 70000, 'all', { deletedAt: 1 }),
    ];
    const bal = computeBalances(members, ex, []);
    expect(sum(Object.values(bal))).toBe(0);
    expect(totalSpend(ex)).toBe(233332);
  });

  it('recorded payments reduce balances', () => {
    const ex = [expense('a', 40000, 'all')];
    const pay: Payment = { id: 'p', groupId: 'g', fromId: 'b', toId: 'a', amount: 10000, createdAt: 0, updatedAt: 0, deletedAt: null };
    const bal = computeBalances(members, ex, [pay]);
    expect(bal.b).toBe(0);
    expect(bal.a).toBe(20000);
  });

  it('simplifies to at most n−1 transfers that settle everything exactly', () => {
    const ex = [
      expense('a', 120000, 'all'),
      expense('b', 45000, ['a', 'b']),
      expense('c', 80001, ['b', 'd']),
      expense('d', 9900, 'all'),
      expense('a', 31000, ['c']),
    ];
    const bal = computeBalances(members, ex, []);
    const transfers = simplifyDebts(bal);
    expect(transfers.length).toBeLessThanOrEqual(members.length - 1);
    const after = { ...bal };
    for (const t of transfers) {
      expect(Number.isInteger(t.amount)).toBe(true);
      after[t.from] += t.amount;
      after[t.to] -= t.amount;
    }
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
  });

  it('nothing to settle when even', () => {
    expect(simplifyDebts({ a: 0, b: 0 })).toEqual([]);
  });
});

describe('upi', () => {
  it('builds the standard pay URI without mangling @', () => {
    const uri = buildUpiUri({ upiId: ' Rohan.B@okHDFC ', payeeName: 'Rohan B', amount: 42050, groupName: 'Flat 4B (Indiranagar)' });
    expect(uri).toBe('upi://pay?pa=rohan.b@okhdfc&pn=Rohan%20B&am=420.50&cu=INR&tn=Flat_4B_Indiranagar_SETTLEMENT');
  });
  it('validates ids', () => {
    expect(isValidUpiId('9876543210@ybl')).toBe(true);
    expect(isValidUpiId('rohan@oksbi')).toBe(true);
    expect(isValidUpiId('rohan')).toBe(false);
    expect(isValidUpiId('@ybl')).toBe(false);
  });
});
