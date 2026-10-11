'use client';

import { create } from 'zustand';
import { useEffect } from 'react';

interface Toast {
  id: number;
  message: string;
  tone: 'default' | 'warn';
  action?: { label: string; run: () => void };
}

interface ToastState {
  toast: Toast | null;
  show(message: string, opts?: { tone?: Toast['tone']; action?: Toast['action'] }): void;
  dismiss(): void;
}

let seq = 0;
export const useToast = create<ToastState>((set) => ({
  toast: null,
  show: (message, opts) => set({ toast: { id: ++seq, message, tone: opts?.tone ?? 'default', action: opts?.action } }),
  dismiss: () => set({ toast: null }),
}));

export const toast = (message: string, opts?: Parameters<ToastState['show']>[1]) => useToast.getState().show(message, opts);

export function Toaster() {
  const t = useToast((s) => s.toast);
  const dismiss = useToast((s) => s.dismiss);

  useEffect(() => {
    if (!t) return;
    const timer = setTimeout(dismiss, t.action ? 5000 : 3000);
    return () => clearTimeout(timer);
  }, [t, dismiss]);

  if (!t) return null;
  return (
    <div className="pointer-events-none bottom-safe fixed inset-x-0 z-50 mb-[104px] flex justify-center px-4">
      <div
        key={t.id}
        role="status"
        aria-live="polite"
        className="rise glass pointer-events-auto flex min-h-12 max-w-md items-center gap-3 rounded-2xl py-2 pr-2 pl-4 text-[15px] shadow-[var(--shadow)]"
      >
        <span className={t.tone === 'warn' ? 'text-accent-strong' : ''}>{t.message}</span>
        {t.action && (
          <button
            className="min-h-10 rounded-xl px-3 font-semibold text-accent-strong hover:bg-sunk"
            onClick={() => {
              t.action!.run();
              dismiss();
            }}
          >
            {t.action.label}
          </button>
        )}
      </div>
    </div>
  );
}
