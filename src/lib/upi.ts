import type { Paise } from './types';

const UPI_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

export function normaliseUpiId(value: string): string {
  return value.trim().replace(/\s+/g, '').toLowerCase();
}

export function isValidUpiId(value: string): boolean {
  return UPI_ID.test(normaliseUpiId(value));
}

/** Percent-encode for a UPI query value but keep '@', which several UPI apps refuse to decode. */
function encodeUpiValue(v: string): string {
  return encodeURIComponent(v).replace(/%40/g, '@');
}

/** Transaction notes: UPI apps truncate around 50 chars and some reject symbols. */
export function settlementNote(groupName: string): string {
  const base = groupName.replace(/[^a-zA-Z0-9 ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 36) || 'Murmur';
  return `${base}_SETTLEMENT`;
}

/** upi://pay?pa={UPI_ID}&pn={NAME}&am={AMOUNT}&cu=INR&tn={GROUP_NAME}_SETTLEMENT */
export function buildUpiUri(opts: { upiId: string; payeeName: string; amount: Paise; groupName: string }): string {
  const params = [
    ['pa', normaliseUpiId(opts.upiId)],
    ['pn', opts.payeeName.trim().slice(0, 50)],
    ['am', (opts.amount / 100).toFixed(2)],
    ['cu', 'INR'],
    ['tn', settlementNote(opts.groupName)],
  ];
  return `upi://pay?${params.map(([k, v]) => `${k}=${encodeUpiValue(v)}`).join('&')}`;
}
