# Product Specification & Technical Build Prompt: Murmur

## 1. System Vision & Architecture Principles
Build a mobile-first, Progressive Web App (PWA) called **Murmur**—an ambient, zero-cost, multi-modal expense capture and settlement ledger for flatmates and trip groups in India.

### Architectural Tenets
1. **Zero-Compute Cost on Capture:** No continuous cloud audio streams. Voice transcription happens client-side via the browser's native Web Speech API (`webkitSpeechRecognition`).
2. **Dump First, Reconcile Later:** Sub-3-second capture loop. Never interrupt input with modal selectors or immediate category prompts.
3. **Multi-Modal Redundancy:** Equal-priority fallback capture for loud environments (client-side OCR) and zero-noise environments (single-line text scratchpad).
4. **Zero-Login Group Onboarding:** Rooms are created via random cryptographic URLs. Members join via link, specify their display name and UPI ID, and sync in real time via Supabase/IndexedDB.
5. **Modern Open UI Canvas:** Clean, responsive, high-contrast dark/light modern UI with fluid segment tabs and gesture-friendly floating action bars. Avoid cluttered card grids, heavy borders, and nested containers.

---

## 2. Core Feature Specifications

### A. The 3-Second Input Bar (Sticky Floating Dock)
The bottom of the viewport contains a floating, frosted glass dock with three triggers:
1. **Hold/Tap-to-Speak (Center Hero):**
   - Web Speech API configured for `lang: 'en-IN'`.
   - Audio visualizer feedback (canvas ripple or pulsing ring) on record.
   - Streams live interim text to a transient toast banner.
   - On release: triggers haptic feedback (`navigator.vibrate(50)`), drops entry into the pending buffer, and evaluates parsing locally.
2. **Camera / Screenshot Upload (Left):**
   - Native file picker accepting image capture/gallery selection (`accept="image/*"`).
   - In-browser OCR via `Tesseract.js` (Web Worker).
   - Extracts numeric totals, vendor name, and date from receipts/Swiggy screenshots without server roundtrips.
3. **Shorthand Scratchpad (Right):**
   - Single-line keyboard input accepting unstructured shorthand (e.g., `"auto 140 kabir"` or `"swiggy 890 all"`).

### B. Context-Aware Hybrid Parser Pipeline
When raw text is captured (from voice, OCR, or text), run the following deterministic pipeline:
1. **Group Entity Dictionary:** Fetch the active group's member list (names, aliases, default currency).
2. **Deterministic Regex Engine (Step 1):**
   - **Amount:** Regex matching currency markers (`₹`, `rs`, `rupees`, `bucks`, or standalone floats).
   - **Payer:** Scans for keywords (`paid by [Name]`, `[Name] paid`, or defaults to the device owner if omitted).
   - **Beneficiaries:** Scans for split keywords (`split with [Names]`, `between [Names]`, `all`, `everyone`). Defaults to `ALL` active members if unspecified.
3. **Ambiguity Flagging:**
   - If regex cannot determine the amount or payer with confidence >= 80%, do **NOT** fail. Save the item into the stream marked as `status: 'unresolved'`.
   - The user or group organizer can tap the card during the later settlement phase to resolve it in 2 clicks.

### C. Live Activity Stream ("The Dump")
- A reverse-chronological feed showing recent captures.
- Each card displays: Raw speech snippet/image thumbnail, parsed breakdown badge (e.g., `"₹420 • Paid by You • Split: All (4)"`), relative timestamp, and status.
- Tap to inline-edit any value directly.

### D. Settlement Engine & Aesthetic UPI Card Generation
1. **Debt Simplification Algorithm:**
   - Run a greedy debt minimization algorithm across all group members to reduce total transactions (e.g., 10 multi-way debts collapsed into 2 direct settlements).
2. **Visual Settlement Card (Client-Side Canvas/SVG):**
   - Generates an exportable, high-res graphic designed for sharing directly on WhatsApp.
   - Contains: Group name, total spend, per-person settlement matrix.
   - Embeds a dynamic UPI QR code for each owing member using the standard protocol:
     `upi://pay?pa={UPI_ID}&pn={NAME}&am={AMOUNT}&cu=INR&tn={GROUP_NAME}_SETTLEMENT`
   - Single-tap action: "Copy Summary Text" and "Share Image via Web Share API".