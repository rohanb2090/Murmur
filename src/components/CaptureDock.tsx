'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Keyboard, Mic, SendHorizontal, X, Loader2 } from 'lucide-react';
import { useVoiceCapture } from '@/hooks/useVoiceCapture';
import { toast } from './Toaster';

interface Props {
  onText(text: string, mode: 'voice' | 'text'): void;
  onImage(file: File): void;
  ocrProgress: number | null;
}

const HOLD_MS = 350;

/**
 * The 3-second input bar: camera (left), hold/tap-to-speak (centre),
 * shorthand scratchpad (right). Never asks a question — it just captures.
 */
export function CaptureDock({ onText, onImage, ocrProgress }: Props) {
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pressedAt = useRef(0);

  const voice = useVoiceCapture((text) => {
    navigator.vibrate?.(50);
    onText(text, 'voice');
  });

  useEffect(() => {
    if (voice.error) {
      toast(voice.error, { tone: 'warn' });
      voice.clearError();
    }
  }, [voice]);

  useEffect(() => {
    if (typing) inputRef.current?.focus();
  }, [typing]);

  const listening = voice.state === 'listening';

  const onMicDown = (e: React.PointerEvent) => {
    e.preventDefault();
    if (listening) return; // second tap handled on pointerup
    if (!voice.supported) {
      toast("Voice isn't available in this browser. Type it or snap a receipt.", { tone: 'warn' });
      setTyping(true);
      return;
    }
    pressedAt.current = Date.now();
    if (voice.start()) navigator.vibrate?.(30);
  };

  const onMicUp = () => {
    if (!voice.supported) return;
    const held = Date.now() - pressedAt.current;
    if (listening && pressedAt.current === 0) {
      voice.stop(); // tap-to-toggle: second tap stops
      return;
    }
    if (held >= HOLD_MS) voice.stop(); // hold-to-speak: release stops
    pressedAt.current = 0; // a quick tap leaves it listening until the next tap
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onText(text, 'text');
    setDraft('');
    navigator.vibrate?.(20);
  };

  return (
    <>
      {(listening || ocrProgress !== null) && (
        <div className="bottom-safe pointer-events-none fixed inset-x-0 z-30 mb-[104px] flex justify-center px-4">
          <div className="rise glass flex min-h-12 w-full max-w-md items-center gap-3 rounded-2xl px-4 py-3 shadow-[var(--shadow)]" aria-live="polite">
            {listening ? (
              <>
                <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-owe" />
                <span className={voice.interim ? 'text-[15px]' : 'text-[15px] text-muted'}>
                  {voice.interim || 'Listening — say “auto 140 split with Kabir”'}
                </span>
              </>
            ) : (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent-strong" />
                <span className="text-[15px]">
                  Reading receipt{ocrProgress && ocrProgress > 0 ? ` · ${Math.round(ocrProgress * 100)}%` : '…'}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      <div className="bottom-safe fixed inset-x-0 z-30 flex justify-center px-4">
        <div className="glass spring flex w-full max-w-md items-center gap-2 rounded-[32px] p-2 shadow-[var(--shadow)]">
          {typing ? (
            <form
              className="flex flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <button
                type="button"
                aria-label="Close keyboard input"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-muted hover:bg-sunk"
                onClick={() => setTyping(false)}
              >
                <X className="h-5 w-5" />
              </button>
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                enterKeyHint="send"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-label="Type an expense"
                placeholder="swiggy 890 all"
                className="h-12 min-w-0 flex-1 rounded-full bg-sunk px-4 text-[16px] outline-none placeholder:text-faint"
              />
              <button
                type="submit"
                aria-label="Log expense"
                disabled={!draft.trim()}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:opacity-40"
              >
                <SendHorizontal className="h-5 w-5" />
              </button>
            </form>
          ) : (
            <div className="flex flex-1 items-center justify-between px-2">
              <button
                aria-label="Snap or upload a receipt"
                disabled={ocrProgress !== null}
                onClick={() => fileRef.current?.click()}
                className="flex h-14 w-14 items-center justify-center rounded-full text-text hover:bg-sunk disabled:opacity-40"
              >
                <Camera className="h-6 w-6" />
              </button>

              <div className="relative -my-6">
                {listening && (
                  <>
                    <span className="ripple-ring" />
                    <span className="ripple-ring" />
                    <span className="ripple-ring" />
                  </>
                )}
                <button
                  aria-label={listening ? 'Stop and save' : 'Hold to speak an expense'}
                  aria-pressed={listening}
                  onPointerDown={onMicDown}
                  onPointerUp={onMicUp}
                  onPointerCancel={() => listening && voice.stop()}
                  onContextMenu={(e) => e.preventDefault()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (listening) voice.stop();
                      else if (voice.supported) voice.start();
                      else setTyping(true);
                    }
                  }}
                  className={`spring relative flex h-[76px] w-[76px] touch-none select-none items-center justify-center rounded-full bg-accent text-on-accent shadow-[0_10px_30px_-8px_var(--accent)] ${
                    listening ? 'scale-110' : 'active:scale-95'
                  }`}
                >
                  <Mic className="h-8 w-8" strokeWidth={2.2} />
                </button>
              </div>

              <button
                aria-label="Type an expense"
                onClick={() => setTyping(true)}
                className="flex h-14 w-14 items-center justify-center rounded-full text-text hover:bg-sunk"
              >
                <Keyboard className="h-6 w-6" />
              </button>
            </div>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onImage(file);
        }}
      />
    </>
  );
}
