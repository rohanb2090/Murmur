'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, UserPlus, Cloud, CloudOff, RefreshCw, HardDrive } from 'lucide-react';
import type { Room } from '@/lib/types';
import { useMurmur } from '@/store/murmur';
import { useRoomSync, type SyncState } from '@/sync/useRoomSync';
import { syncEnabled } from '@/sync/supabase';
import { formatINR } from '@/lib/money';
import { extractReceipt } from '@/lib/receipt';
import { CaptureDock } from './CaptureDock';
import { Dump } from './Dump';
import { Balances } from './Balances';
import { Settle } from './Settle';
import { toast } from './Toaster';

type Tab = 'dump' | 'balances' | 'settle';

export function RoomScreen({ room }: { room: Room }) {
  const slug = room.group.slug;
  const [tab, setTab] = useState<Tab>('dump');
  const [filter, setFilter] = useState<'all' | 'unresolved'>('all');
  const [freshId, setFreshId] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const capture = useMurmur((s) => s.capture);
  const captureReceipt = useMurmur((s) => s.captureReceipt);
  const remove = useMurmur((s) => s.deleteExpense);
  const leave = useMurmur((s) => s.leaveRoom);
  const sync = useRoomSync(slug);

  const unresolved = room.expenses.filter((e) => e.deletedAt === null && e.status === 'unresolved').length;

  const landed = (id: string) => {
    setFreshId(id);
    setTab('dump');
    setFilter('all');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onText = (text: string, mode: 'voice' | 'text') => {
    const e = capture(slug, text, mode);
    if (!e) return;
    landed(e.id);
    const undo = { label: 'Undo', run: () => remove(slug, e.id) };
    if (e.status === 'resolved') toast(`Logged ${formatINR(e.amount!)} · ${e.description}`, { action: undo });
    else toast(`Saved — ${e.issues[0]?.toLowerCase() ?? 'needs details'}`, { tone: 'warn', action: undo });
  };

  const onImage = async (file: File) => {
    setOcrProgress(0);
    try {
      const { readReceipt } = await import('@/lib/ocr');
      const { text, thumb } = await readReceipt(file, setOcrProgress);
      const guess = extractReceipt(text);
      const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) ?? 'Receipt';
      const e = captureReceipt(slug, {
        rawInput: guess.vendor ? `${guess.vendor} receipt${guess.date ? ` · ${guess.date}` : ''}\n${text}` : `${firstLine}\n${text}`,
        description: guess.vendor ?? 'Receipt',
        amount: guess.amount,
        confident: guess.amountConfident,
        thumb,
      });
      if (!e) return;
      landed(e.id);
      if (e.status === 'resolved') toast(`Logged ${formatINR(e.amount!)} · ${e.description}`, { action: { label: 'Undo', run: () => remove(slug, e.id) } });
      else toast(e.amount === null ? "Saved — couldn't read a total" : `Saved ${formatINR(e.amount)} — check the total`, { tone: 'warn' });
    } catch (err) {
      console.warn('[murmur] OCR failed', err);
      toast(navigator.onLine ? "Couldn't read that image. Type the amount instead." : 'Receipt reading needs a connection the first time. Type it instead.', { tone: 'warn' });
    } finally {
      setOcrProgress(null);
    }
  };

  const invite = async () => {
    if (!syncEnabled) {
      toast('This room lives on this phone only. Add flatmates under Balances, or turn on cloud sync to share it.', { tone: 'warn' });
      setTab('balances');
      return;
    }
    const url = `${location.origin}/r#${slug}`;
    const text = `Join “${room.group.name}” on Murmur to log shared expenses`;
    try {
      if (navigator.share) await navigator.share({ title: room.group.name, text, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Invite link copied');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast("Couldn't share the link", { tone: 'warn' });
    }
  };

  return (
    <main className="pb-dock mx-auto min-h-dvh max-w-xl">
      <header className="flex items-center gap-1 px-2 pt-[calc(10px+env(safe-area-inset-top))]">
        <Link href="/" aria-label="All rooms" className="flex h-12 w-12 items-center justify-center rounded-full text-muted hover:bg-sunk">
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-display truncate text-[24px] leading-tight font-bold">{room.group.name}</h1>
          <p className="truncate text-[13px] text-muted">
            {room.members.length} {room.members.length === 1 ? 'person' : 'people'} · <SyncLabel state={sync} />
          </p>
        </div>
        <button onClick={invite} className="flex min-h-12 items-center gap-2 rounded-full px-4 text-[14.5px] font-semibold hover:bg-sunk">
          <UserPlus className="h-5 w-5" /> Invite
        </button>
      </header>

      <nav className="glass sticky top-0 z-20 mt-2 px-5 py-2" aria-label="Room sections">
        <div className="relative grid grid-cols-3 rounded-full bg-sunk p-1" role="tablist">
          <span
            aria-hidden
            className="spring absolute top-1 bottom-1 left-1 w-[calc((100%-8px)/3)] rounded-full bg-surface shadow-sm"
            style={{ transform: `translateX(${['dump', 'balances', 'settle'].indexOf(tab) * 100}%)` }}
          />
          {(
            [
              ['dump', 'The dump', unresolved],
              ['balances', 'Balances', 0],
              ['settle', 'Settle up', 0],
            ] as const
          ).map(([key, label, badge]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`relative z-10 min-h-11 rounded-full text-[14.5px] transition-colors ${tab === key ? 'font-semibold text-text' : 'text-muted'}`}
            >
              {label}
              {badge > 0 && (
                <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-on-accent">{badge}</span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {tab === 'dump' && <Dump room={room} filter={filter} onFilter={setFilter} freshId={freshId} />}
      {tab === 'balances' && (
        <>
          <Balances room={room} />
          <div className="px-5 pb-6">
            <button
              onClick={() => {
                if (confirmLeave(room)) {
                  leave(slug);
                  location.href = '/';
                }
              }}
              className="min-h-11 rounded-xl px-1 text-[14px] text-owe"
            >
              Remove this room from this phone
            </button>
          </div>
        </>
      )}
      {tab === 'settle' && (
        <Settle
          room={room}
          onReview={() => {
            setFilter('unresolved');
            setTab('dump');
          }}
        />
      )}

      <CaptureDock onText={onText} onImage={onImage} ocrProgress={ocrProgress} />
    </main>
  );
}

function confirmLeave(room: Room): boolean {
  const msg = syncEnabled
    ? `Remove “${room.group.name}” from this phone? You can rejoin with the invite link.`
    : `Delete “${room.group.name}” and all its entries? It only exists on this phone, so this can't be undone.`;
  return window.confirm(msg);
}

function SyncLabel({ state }: { state: SyncState }) {
  const map: Record<SyncState, [React.ComponentType<{ className?: string }>, string]> = {
    local: [HardDrive, 'saved on this phone'],
    syncing: [RefreshCw, 'syncing'],
    synced: [Cloud, 'synced'],
    offline: [CloudOff, 'offline — will sync later'],
    error: [CloudOff, "couldn't sync"],
  };
  const [Icon, label] = map[state];
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <Icon className={`h-3.5 w-3.5 ${state === 'syncing' ? 'animate-spin' : ''}`} />
      {label}
    </span>
  );
}
