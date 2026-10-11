# Murmur

Shared expenses for flatmates and trip groups in India. Say it, snap the bill or type shorthand — Murmur logs it in under three seconds, works out who owes whom, and makes a WhatsApp-ready settle-up card with UPI QR codes.

- **Voice** — hold (or tap) the mic and say “auto 140 split with Kabir”. Uses the browser’s built-in speech recognition (`en-IN`), no paid API.
- **Receipts** — snap a bill or a Swiggy/Zomato/Uber screenshot. OCR runs in the browser with Tesseract.js; it picks the *To Pay* / *Grand Total* line, not the item total.
- **Shorthand** — `swiggy 890 all`, `meera paid 1,200 dinner split with ali`, `kabbu ne 600 diya beer`.
- **Dump first, fix later** — anything the parser isn’t sure about is saved as *needs details*, never rejected. Fix it in two taps when you settle.
- **Settle up** — greedy debt simplification (at most n−1 transfers), a shareable PNG card with a `upi://pay` QR per payee, “Pay with UPI” deep links and “Mark as paid”.

## Run it

```bash
npm install        # also copies the OCR engine into public/tesseract
npm run dev        # http://localhost:3000
npm test           # parser, ledger, UPI and receipt tests
npm run build && npm start
```

Voice capture needs HTTPS (or localhost) and works best in Chrome on Android. To try it on your phone during development, run behind an HTTPS tunnel.

## Modes

**Local-first (default).** With no environment variables set, each room lives in IndexedDB on one phone. Add flatmates under *Balances* and log for everyone. Everything works offline once the app has loaded.

**Shared rooms (Supabase).** To let everyone join from their own phone:

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor.
2. Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Restart. Rooms created offline are published on the next sync; *Invite* now shares a link.

Devices keep working offline and push their changes when they reconnect (last write wins per entry). A Realtime broadcast ping tells other phones in the room to re-pull.

## How rooms stay private without logins

- A room link looks like `/r#<22-char random key>` (~131 bits). The part after `#` is never sent to a server, so keys don’t end up in hosting logs.
- Row Level Security is on with **no policies**: the public anon key cannot read or write any table directly. All access goes through three `SECURITY DEFINER` functions (`create_room`, `get_room`, `push_changes`) that require the room key and only touch that room’s rows.
- Anyone with the link can see and edit the room — the same trust model as a shared Google Doc link. Don’t post room links publicly.

## Project layout

```
src/lib/parser.ts         deterministic text → expense parser (no LLM)
src/lib/ledger.ts         balances + debt simplification, integer paise
src/lib/receipt.ts        total / vendor / date extraction from OCR text
src/lib/upi.ts            upi://pay URIs and UPI ID validation
src/lib/settlementCard.ts canvas card, QR codes, Web Share
src/lib/ocr.ts            lazy Tesseract worker (self-hosted assets)
src/hooks/useVoiceCapture.ts  hold/tap speech recognition
src/store/murmur.ts       Zustand store persisted to IndexedDB
src/sync/                 Supabase RPC client + room sync hook
supabase/schema.sql       tables, RLS lock-down, RPCs
public/sw.js              offline shell + OCR asset cache
```

## Known limits

- **Voice isn’t on-device.** Chrome’s speech recognition is free but streams audio to Google’s speech service, so it needs a connection. iOS Safari support is patchy, especially when installed to the home screen; Firefox has none. The keyboard and camera are always there as fallbacks.
- **OCR is heavy on first use** — about 20 MB (engine + English model) downloads the first time someone taps the camera, then it’s cached. Expect a few seconds per receipt on mid-range Android.
- **Equal splits only** for now. The data model stores split members, so unequal shares can be added later.
- **The parser is heuristic.** It handles amounts (₹, rs, /-, 1,20,000, 4.5k), payers (“X paid”, “paid by X”, “X ne diya”, “I paid”), splits (with / between / for / everyone / sab), aliases and headcounts. Anything uncertain is flagged rather than guessed silently. Add aliases for names speech recognition misspells.
