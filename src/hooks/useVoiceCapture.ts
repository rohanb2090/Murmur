'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/* Minimal typings for the Web Speech API (not in lib.dom for all TS versions). */
interface SpeechAlt {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  0: SpeechAlt;
  length: number;
}
interface SpeechEvent {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechResult };
}
interface SpeechErrorEvent {
  error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone is blocked. Allow it in site settings, or type instead.',
  'service-not-allowed': 'Voice input is turned off in this browser. Type instead.',
  'audio-capture': 'No microphone found. Type instead.',
  network: 'Voice needs an internet connection. Type instead.',
  'language-not-supported': "This browser can't do Indian English voice. Type instead.",
};

export type VoiceState = 'idle' | 'listening';

/**
 * Hold-to-speak / tap-to-toggle voice capture using the browser's built-in
 * speech recognition (en-IN). Free, but note: Chrome sends audio to Google's
 * speech service, so it needs a connection.
 */
export function useVoiceCapture(onTranscript: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<VoiceState>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);

  const rec = useRef<Recognition | null>(null);
  const transcript = useRef('');
  const cancelled = useRef(false);
  const callback = useRef(onTranscript);
  callback.current = onTranscript;

  useEffect(() => {
    setSupported(getCtor() !== null);
    return () => {
      cancelled.current = true;
      rec.current?.abort();
    };
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor || rec.current) return false;
    const r = new Ctor();
    r.lang = 'en-IN';
    r.continuous = true; // keep listening through pauses while the button is held
    r.interimResults = true;
    r.maxAlternatives = 1;
    transcript.current = '';
    cancelled.current = false;
    setError(null);
    setInterim('');

    r.onresult = (e) => {
      // Rebuild from all results each time — robust to Android Chrome re-sending segments.
      let finals = '';
      let pending = '';
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finals += `${res[0].transcript} `;
        else pending += res[0].transcript;
      }
      transcript.current = `${finals}${pending}`.replace(/\s+/g, ' ').trim();
      setInterim(transcript.current);
    };
    r.onerror = (e) => {
      if (e.error === 'aborted') return;
      if (e.error === 'no-speech') setError("Didn't catch that. Try again closer to the mic.");
      else setError(ERRORS[e.error] ?? 'Voice input stopped. Type instead.');
    };
    r.onend = () => {
      rec.current = null;
      setState('idle');
      setInterim('');
      const text = transcript.current.trim();
      if (!cancelled.current && text) callback.current(text);
    };

    try {
      r.start();
      rec.current = r;
      setState('listening');
      return true;
    } catch {
      setError('Voice input is busy. Try again.');
      return false;
    }
  }, []);

  const stop = useCallback(() => {
    rec.current?.stop(); // onend delivers the transcript
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    rec.current?.abort();
  }, []);

  return { supported, state, interim, error, clearError: () => setError(null), start, stop, cancel };
}
