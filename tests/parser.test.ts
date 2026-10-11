import { describe, expect, it } from 'vitest';
import { parseExpense } from '@/lib/parser';

const members = [
  { id: 'rohan', name: 'Rohan' },
  { id: 'kabir', name: 'Kabir Singh', aliases: ['kabbu'] },
  { id: 'meera', name: 'Meera' },
  { id: 'ali', name: 'Ali' },
];
const parse = (t: string, me: string | null = 'rohan') => parseExpense(t, members, me);

describe('amounts', () => {
  it.each([
    ['auto 140', 14000],
    ['swiggy ₹890', 89000],
    ['dinner rs. 1,200', 120000],
    ['rent 1,20,000', 12000000],
    ['groceries 450 rupees', 45000],
    ['beer 600 bucks', 60000],
    ['flight 4.5k', 450000],
    ['cab 249.50', 24950],
    ['chai 40/-', 4000],
    ['hotel 2 thousand', 200000],
  ])('%s → %i paise', (text, paise) => {
    expect(parse(text).amount).toBe(paise);
  });

  it('ignores headcounts and prefers currency-marked numbers', () => {
    expect(parse('dinner split between 3 ₹1500').amount).toBe(150000);
    expect(parse('dinner for 4 people 2400').amount).toBe(240000);
    expect(parse('2 beers ₹600').amount).toBe(60000);
  });

  it('flags several unmarked amounts as unresolved', () => {
    const r = parse('2 pizzas 900');
    expect(r.amount).toBe(90000);
    expect(r.status).toBe('unresolved');
    expect(r.issues[0]).toMatch(/Several amounts/);
  });

  it('saves without an amount instead of failing', () => {
    const r = parse('paid for the movie tickets');
    expect(r.amount).toBeNull();
    expect(r.status).toBe('unresolved');
    expect(r.issues).toContain('No amount found');
  });
});

describe('payer', () => {
  it('defaults to the device owner', () => {
    const r = parse('swiggy 890 all');
    expect(r.paidBy).toBe('rohan');
    expect(r.splitAll).toBe(true);
    expect(r.status).toBe('resolved');
  });
  it('reads "X paid", "paid by X", Hinglish "X ne diya"', () => {
    expect(parse('kabir paid 500 for petrol').paidBy).toBe('kabir');
    expect(parse('petrol 500 paid by meera').paidBy).toBe('meera');
    expect(parse('meera ne 300 diya chai').paidBy).toBe('meera');
    expect(parse('kabbu has paid 200').paidBy).toBe('kabir');
    expect(parse('kabir singh paid 200').paidBy).toBe('kabir');
  });
  it('reads "I paid" and "maine"', () => {
    expect(parse('i paid 300 for snacks', 'meera').paidBy).toBe('meera');
    expect(parse('maine 500 diye cab', 'kabir').paidBy).toBe('kabir');
  });
  it('matches whole words only — "Ali" is not inside "Alibaug"', () => {
    const r = parse('alibaug ferry 600');
    expect(r.splitAll).toBe(true);
    expect(r.description).toBe('Alibaug ferry');
  });
  it('flags an unknown payer', () => {
    const r = parse('paid by zoya 800');
    expect(r.paidBy).toBeNull();
    expect(r.status).toBe('unresolved');
    expect(r.issues).toContain('"zoya" isn\'t in this room');
  });
  it('with no device owner and no payer, asks who paid', () => {
    const r = parse('auto 140', null);
    expect(r.paidBy).toBeNull();
    expect(r.status).toBe('unresolved');
  });
});

describe('split', () => {
  it('"auto 140 kabir" → shared between me and Kabir', () => {
    const r = parse('auto 140 kabir');
    expect(r.paidBy).toBe('rohan');
    expect(r.splitAll).toBe(false);
    expect(r.splitMemberIds.sort()).toEqual(['kabir', 'rohan']);
    expect(r.description).toBe('Auto');
  });
  it('"split with" includes the payer', () => {
    const r = parse('kabir paid 900 dinner split with meera and ali');
    expect(r.paidBy).toBe('kabir');
    expect(r.splitMemberIds.sort()).toEqual(['ali', 'kabir', 'meera']);
  });
  it('payer named inside the split list stays in it', () => {
    const r = parse('rohan paid 600 split between rohan and kabir');
    expect(r.splitMemberIds.sort()).toEqual(['kabir', 'rohan']);
  });
  it('"between" / "for" are exact', () => {
    expect(parse('cake 800 between meera and ali').splitMemberIds.sort()).toEqual(['ali', 'meera']);
    expect(parse('paid 250 for kabir medicine').splitMemberIds).toEqual(['kabir']);
  });
  it('"for dinner" is a description, not an unknown person', () => {
    const r = parse('paid 1200 for dinner');
    expect(r.status).toBe('resolved');
    expect(r.description).toBe('Dinner');
    expect(r.splitAll).toBe(true);
  });
  it('"everyone" / "sab" → all', () => {
    expect(parse('cylinder 1100 split with everyone').splitAll).toBe(true);
    expect(parse('sab ke liye pizza 900').splitAll).toBe(true);
  });
  it('flags an unknown name in a split', () => {
    const r = parse('movie 900 split with zoya');
    expect(r.status).toBe('unresolved');
    expect(r.issues).toContain('"zoya" isn\'t in this room');
  });
  it('"with me" from someone else\'s phone', () => {
    const r = parse('kabir paid 400 split with me', 'meera');
    expect(r.splitMemberIds.sort()).toEqual(['kabir', 'meera']);
  });
});

describe('description', () => {
  it('keeps the leftover words', () => {
    expect(parse('uber to airport 650').description).toBe('Uber to airport');
    expect(parse('₹450').description).toBe('Expense');
  });
});
