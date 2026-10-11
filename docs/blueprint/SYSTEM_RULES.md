# Instructions for Coding Agent (Cursor / Claude Code / Bolt)

You are tasked with generating the complete, working codebase for **Murmur**, an ambient, zero-cost shared expense tracker for flatmates and trip groups in India.

Follow these strict constraints:
1. **Tech Stack:** Next.js (App Router, React 19, TypeScript), Tailwind CSS, Lucide React, Zustand for state management, `idb-keyval` for offline storage, and Supabase for cloud sync.
2. **Zero-Cost Voice Transcription:** DO NOT import or call external cloud voice APIs (no Whisper API, no Deepgram, no ElevenLabs). Rely strictly on `window.SpeechRecognition` / `window.webkitSpeechRecognition` with `lang = 'en-IN'`.
3. **Deterministic Parsing:** Do not call OpenAI or external LLMs for standard expense parsing. Use the provided deterministic regex pipeline in `src/lib/parser.ts`.
4. **Mobile-First UX:** The UI must feel like a fluid native app. Ensure touch targets are at least 48px, use backdrop blur effects, high contrast typography, and fluid spring transitions.
5. **No Broken Placeholders:** Write full, production-ready implementation code with proper error handling, fallback states, and TypeScript interfaces.