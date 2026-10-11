'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Moon, Sun, ChevronRight } from 'lucide-react';
import { useMurmur } from '@/store/murmur';
import { parseExpense } from '@/lib/parser';
import { formatINR } from '@/lib/money';
import { breakdown } from '@/lib/format';
import { computeBalances } from '@/lib/ledger';
import { isValidUpiId } from '@/lib/upi';
import { isValidSlug } from '@/lib/id';
import { syncEnabled } from '@/sync/supabase';
import type { Expense, Member } from '@/lib/types';
import { Field } from '@/components/Balances';

const DEMO_MEMBERS: Member[] = ['You', 'Kabir', 'Meera', 'Ali'].map((name, i) => ({
  id: `demo-${i}`,
  groupId: 'demo',
  name,
  aliases: [],
  upiId: null,
  deviceId: null,
  createdAt: 0,
  updatedAt: 0,
}));
const DEMO_LINES = ['auto 140 kabir', 'meera paid 1,200 dinner split with ali', 'swiggy ₹890 all', 'cylinder 1100 paid by zoya'];

export default function Home() {
  const router = useRouter();
  const hydrated = useMurmur((s) => s.hydrated);
  const rooms = useMurmur((s) => s.rooms);
  const createRoom = useMurmur((s) => s.createRoom);
  const [creating, setCreating] = useState(false);

  const list = Object.values(rooms).sort((a, b) => latest(b) - latest(a));
  const showForm = creating || (hydrated && list.length === 0);

  return (
    <main className="mx-auto min-h-dvh max-w-xl px-5 pt-[calc(18px+env(safe-area-inset-top))] pb-16">
      <header className="flex items-center justify-between">
        <span className="font-display flex items-center gap-2 text-[22px] font-bold tracking-tight">
          <span className="relative flex h-6 w-6 items-center justify-center" aria-hidden>
            <span className="absolute inset-0 rounded-full bg-accent opacity-30" />
            <span className="h-3 w-3 rounded-full bg-accent" />
          </span>
          murmur
        </span>
        <ThemeToggle />
      </header>

      <section className="pt-10">
        <h1 className="font-display text-[44px] leading-[0.98] font-bold tracking-[-0.03em] sm:text-[56px]">
          Mutter what you paid.
          <br />
          <span className="text-muted">Settle up later.</span>
        </h1>
        <p className="mt-4 max-w-[36ch] text-[16px] leading-relaxed text-muted">
          Shared expenses for flatmates and trips. Speak it, snap the bill or type shorthand — Murmur works out who owes whom and makes a UPI card to share.
        </p>
        <Demo />
      </section>

      {hydrated && list.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-[20px] font-semibold">Your rooms</h2>
          <ul className="mt-2">
            {list.map((r) => {
              const me = computeBalances(r.members, r.expenses, r.payments)[r.meId] ?? 0;
              const pending = r.expenses.filter((e) => e.deletedAt === null && e.status === 'unresolved').length;
              return (
                <li key={r.group.slug}>
                  <a href={`/r#${r.group.slug}`} className="flex min-h-16 items-center gap-3 border-b border-line py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[17px] font-semibold">{r.group.name}</p>
                      <p className="text-[13px] text-muted">
                        {r.members.length} {r.members.length === 1 ? 'person' : 'people'}
                        {pending > 0 && <span className="text-accent-strong"> · {pending} need details</span>}
                      </p>
                    </div>
                    <span className={`num text-[18px] font-bold ${me > 0 ? 'text-owed' : me < 0 ? 'text-owe' : 'text-muted'}`}>
                      {me === 0 ? 'square' : me > 0 ? `you get ${formatINR(me)}` : `you owe ${formatINR(-me)}`}
                    </span>
                    <ChevronRight className="h-5 w-5 text-faint" />
                  </a>
                </li>
              );
            })}
          </ul>
          {!creating && (
            <button onClick={() => setCreating(true)} className="mt-4 min-h-12 rounded-xl bg-accent px-5 font-semibold text-on-accent">
              Start a room
            </button>
          )}
        </section>
      )}

      {showForm && (
        <CreateRoom
          onCreate={(input) => {
            const slug = createRoom(input);
            router.push(`/r#${slug}`);
          }}
          onCancel={list.length ? () => setCreating(false) : undefined}
        />
      )}

      {hydrated && syncEnabled && <JoinByLink />}

      {hydrated && !syncEnabled && (
        <p className="mt-12 text-[13px] leading-relaxed text-faint">
          Rooms are kept on this phone. To share a room across phones, connect Supabase (see the README).
        </p>
      )}
    </main>
  );
}

const latest = (r: { expenses: Expense[]; group: { createdAt: number } }) => Math.max(r.group.createdAt, ...r.expenses.map((e) => e.updatedAt));

function Demo() {
  const [text, setText] = useState(DEMO_LINES[0]);
  const parsed = useMemo(() => parseExpense(text, DEMO_MEMBERS, 'demo-0'), [text]);
  const asExpense = { ...parsed, captureMode: 'text', rawInput: text } as unknown as Expense;
  return (
    <div className="mt-8 rounded-3xl bg-surface p-4 shadow-[var(--shadow)]">
      <label className="block">
        <span className="text-[13px] text-muted">Try it — type like you’d text a flatmate</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoCapitalize="none"
          spellCheck={false}
          className="mt-2 h-12 w-full rounded-xl bg-sunk px-3 text-[16px] outline-none"
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {DEMO_LINES.map((l) => (
          <button key={l} onClick={() => setText(l)} className={`min-h-9 rounded-full px-3 text-[13px] ${l === text ? 'bg-text text-bg' : 'bg-sunk text-muted'}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-4">
        <span className="truncate text-[17px] font-semibold">{parsed.description}</span>
        <span className={`num text-[28px] font-bold ${parsed.amount === null ? 'text-accent-strong' : ''}`}>
          {parsed.amount === null ? '₹ ?' : formatINR(parsed.amount)}
        </span>
      </div>
      <p className="text-[13.5px] text-muted">{breakdown(asExpense, DEMO_MEMBERS, 'demo-0')}</p>
      {parsed.status === 'unresolved' && (
        <p className="mt-1 text-[13.5px] font-medium text-accent-strong">{parsed.issues.join(' · ')} — saved anyway, fix it later</p>
      )}
    </div>
  );
}

function CreateRoom({ onCreate, onCancel }: { onCreate(input: { roomName: string; myName: string; upiId?: string }): void; onCancel?: () => void }) {
  const [roomName, setRoomName] = useState('');
  const [myName, setMyName] = useState('');
  const [upi, setUpi] = useState('');
  const upiBad = upi.trim() !== '' && !isValidUpiId(upi);
  return (
    <form
      className="rise mt-12 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!roomName.trim() || !myName.trim() || upiBad) return;
        onCreate({ roomName, myName, upiId: upi.trim() || undefined });
      }}
    >
      <h2 className="font-display text-[20px] font-semibold">Start a room</h2>
      <Field label="Room name">
        <input value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={60} required placeholder="Flat 4B, Goa trip…" className="h-12 w-full rounded-xl bg-sunk px-3 text-[16px] outline-none placeholder:text-faint" />
      </Field>
      <Field label="Your name">
        <input value={myName} onChange={(e) => setMyName(e.target.value)} maxLength={40} required className="h-12 w-full rounded-xl bg-sunk px-3 text-[16px] outline-none" />
      </Field>
      <Field label="Your UPI ID, so people can pay you back (optional)" error={upiBad ? 'Looks like name@bank, e.g. rohan@okhdfc' : undefined}>
        <input
          value={upi}
          onChange={(e) => setUpi(e.target.value)}
          inputMode="email"
          autoCapitalize="none"
          placeholder="rohan@okhdfc"
          className="h-12 w-full rounded-xl bg-sunk px-3 text-[16px] outline-none placeholder:text-faint"
        />
      </Field>
      <div className="flex gap-2 pt-1">
        <button type="submit" className="min-h-12 flex-1 rounded-xl bg-accent font-semibold text-on-accent">
          Start the room
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="min-h-12 rounded-xl px-4 text-muted hover:bg-sunk">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function JoinByLink() {
  const [value, setValue] = useState('');
  const slug = value.trim().split('#').pop()?.split('/').pop() ?? '';
  const ok = isValidSlug(slug);
  return (
    <form
      className="mt-10"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) location.href = `/r#${slug}`;
      }}
    >
      <Field label="Got an invite link? Paste it here" error={value && !ok ? 'That doesn’t look like a Murmur room link' : undefined}>
        <div className="flex gap-2">
          <input value={value} onChange={(e) => setValue(e.target.value)} autoCapitalize="none" className="h-12 min-w-0 flex-1 rounded-xl bg-sunk px-3 text-[16px] outline-none" />
          <button type="submit" disabled={!ok} className="min-h-12 rounded-xl bg-sunk px-4 font-semibold disabled:opacity-40">
            Open
          </button>
        </div>
      </Field>
    </form>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === 'dark'), []);
  return (
    <button
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem('murmur-theme', next);
        } catch {
          /* private mode */
        }
        setDark(next === 'dark');
      }}
      className="flex h-12 w-12 items-center justify-center rounded-full text-muted hover:bg-sunk"
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
