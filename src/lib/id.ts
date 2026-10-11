const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC 4122 v4 fallback for older WebViews.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 22 base62 chars ≈ 131 bits of entropy — the room link is the only key, so it must be unguessable. */
export function newSlug(length = 22): string {
  const out: string[] = [];
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      // Rejection sampling keeps the distribution uniform.
      if (byte < 248 && out.length < length) out.push(BASE62[byte % 62]);
    }
  }
  return out.join('');
}

export function isValidSlug(slug: string): boolean {
  return /^[0-9A-Za-z]{16,64}$/.test(slug);
}
