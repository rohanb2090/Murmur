'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { useMurmur } from '@/store/murmur';
import { fetchRoom, syncEnabled, type RemoteRoom } from '@/sync/supabase';
import { isValidUpiId } from '@/lib/upi';
import { initials } from '@/lib/format';
import { Field } from './Balances';

type Load = { kind: 'loading' } | { kind: 'missing' } | { kind: 'error' } | { kind: 'found'; room: RemoteRoom };

export function JoinRoom({ slug }: { slug: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const joinRoom = useMurmur((s) => s.joinRoom);
  const adoptRoom = useMurmur((s) => s.adoptRoom);
  const updateMember = useMurmur((s) => s.updateMember);
  const deviceId = useMurmur((s) => s.deviceId);
  const [name, setName] = useState('');
  const [upi, setUpi] = useState('');

  useEffect(() => {
    if (!syncEnabled) return;
    fetchRoom(slug)
      .then((room) => setLoad(room ? { kind: 'found', room } : { kind: 'missing' }))
      .catch(() => setLoad({ kind: 'error' }));
  }, [slug]);

  if (!syncEnabled) {
    return (
      <Shell title="This room is on another phone">
        Shared rooms need cloud sync, which isn’t switched on for this copy of Murmur. Ask whoever made the room to add you under Balances — they can log for
        you until sync is set up.
      </Shell>
    );
  }
  if (load.kind === 'loading') {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" aria-label="Loading room" />
      </main>
    );
  }
  if (load.kind === 'missing') return <Shell title="Room not found">Check that you copied the whole link — it’s long on purpose.</Shell>;
  if (load.kind === 'error') return <Shell title="Couldn’t reach the room">Check your connection and open the link again.</Shell>;

  const { room } = load;
  const unclaimed = room.members.filter((m) => !m.deviceId);
  const upiBad = upi.trim() !== '' && !isValidUpiId(upi);
  const dupe = room.members.some((m) => m.name.trim().toLowerCase() === name.trim().toLowerCase());

  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 pt-[calc(28px+env(safe-area-inset-top))] pb-16">
      <p className="text-[14px] text-muted">You’re invited to</p>
      <h1 className="font-display mt-1 text-[36px] leading-tight font-bold">{room.group.name}</h1>
      <p className="mt-2 text-[15px] text-muted">{room.members.map((m) => m.name).join(', ')}</p>

      {unclaimed.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-[18px] font-semibold">Already on the list?</h2>
          <p className="mt-1 text-[14px] text-muted">Someone may have added you. Tap your name to use this phone as you.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {unclaimed.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  adoptRoom({ ...room, meId: m.id });
                  updateMember(slug, m.id, { deviceId });
                }}
                className="flex min-h-12 items-center gap-2 rounded-full bg-sunk py-1 pr-4 pl-1 text-[15px]"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-[13px] font-semibold">{initials(m.name)}</span>
                {m.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <form
        className="mt-8 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || upiBad || dupe) return;
          joinRoom(room, { name, upiId: upi.trim() || undefined });
        }}
      >
        <h2 className="font-display text-[18px] font-semibold">{unclaimed.length ? 'Or join as someone new' : 'Join the room'}</h2>
        <Field label="Your name" error={dupe ? 'That name is taken in this room — tap it above if it’s you' : undefined}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required className="h-12 w-full rounded-xl bg-sunk px-3 text-[16px] outline-none" />
        </Field>
        <Field label="Your UPI ID, so people can pay you back" error={upiBad ? 'Looks like name@bank, e.g. meera@okaxis' : undefined}>
          <input
            value={upi}
            onChange={(e) => setUpi(e.target.value)}
            inputMode="email"
            autoCapitalize="none"
            placeholder="meera@okaxis"
            className="h-12 w-full rounded-xl bg-sunk px-3 text-[16px] outline-none placeholder:text-faint"
          />
        </Field>
        <button type="submit" className="mt-2 min-h-12 w-full rounded-xl bg-accent font-semibold text-on-accent">
          Join {room.group.name}
        </button>
      </form>
    </main>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <h1 className="font-display text-[30px] leading-tight font-bold">{title}</h1>
      <p className="mt-3 text-[16px] leading-relaxed text-muted">{children}</p>
      <Link href="/" className="mt-8 inline-flex min-h-12 w-fit items-center rounded-xl bg-sunk px-5 font-semibold">
        Go to your rooms
      </Link>
    </main>
  );
}
