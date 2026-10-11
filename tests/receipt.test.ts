import { describe, expect, it } from 'vitest';
import { extractReceipt } from '@/lib/receipt';

describe('receipt extraction', () => {
  it('Swiggy-style screenshot: picks "To Pay", not item total or savings', () => {
    const text = `Order Summary
Swiggy
Item Total ₹ 1,040.00
Delivery Fee ₹ 45.00
Taxes and Charges ₹ 62.40
You saved ₹ 120
To Pay ₹ 1,027.40
Paid via UPI on 12 Oct 2026, 9:42 PM`;
    const r = extractReceipt(text);
    expect(r.amount).toBe(102740);
    expect(r.amountConfident).toBe(true);
    expect(r.vendor).toBe('Swiggy');
    expect(r.date).toBe('2026-10-12');
  });

  it('restaurant bill: grand total beats subtotal and GST', () => {
    const text = `THE BLUE DOOR CAFE
GSTIN 29ABCDE1234F1Z5
Date: 03/10/2026
Sub Total 1850.00
CGST 2.5% 46.25
SGST 2.5% 46.25
Grand Total 1942.50`;
    const r = extractReceipt(text);
    expect(r.amount).toBe(194250);
    expect(r.vendor).toBe('The Blue Door Cafe');
    expect(r.date).toBe('2026-10-03');
  });

  it('total on the next line', () => {
    expect(extractReceipt('Total\n₹ 560').amount).toBe(56000);
  });

  it('falls back to the largest rupee amount, not confidently', () => {
    const r = extractReceipt('Ride with Uber\n₹ 212.00\n₹ 12.00');
    expect(r.amount).toBe(21200);
    expect(r.amountConfident).toBe(false);
    expect(r.vendor).toBe('Uber');
  });

  it('nothing found', () => {
    const r = extractReceipt('blurry nonsense');
    expect(r.amount).toBeNull();
  });
});
