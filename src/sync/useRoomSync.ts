'use client';

import { useEffect, useRef, useState } from 'react';
import { useMurmur } from '@/store/murmur';
import { createRemoteRoom, fetchRoom, pushChanges, subscribeRoom, syncEnabled } from './supabase';

export type SyncState = 'local' | 'syncing' | 'synced' | 'offline' | 'error';

/**
 * Keeps one room in sync with Supabase: pull on open, push dirty rows
 * (debounced), re-pull when another device pings, retry when back online.
 */
export function useRoomSync(slug: string): SyncState {
  const [state, setState] = useState<SyncState>(syncEnabled ? 'syncing' : 'local');
  const dirty = useMurmur((s) => s.dirty[slug]);
  const hasRoom = useMurmur((s) => Boolean(s.rooms[slug]));
  const channel = useRef<ReturnType<typeof subscribeRoom> | null>(null);
  const busy = useRef(false);

  const pull = async () => {
    const remote = await fetchRoom(slug);
    if (remote) useMurmur.getState().mergeRemote(slug, remote);
    return remote;
  };

  const push = async () => {
    const { rooms, dirty } = useMurmur.getState();
    const room = rooms[slug];
    const d = dirty[slug];
    if (!room || !d || (!d.members.length && !d.expenses.length && !d.payments.length)) return false;
    const pick = <T extends { id: string }>(xs: T[], ids: string[]) => xs.filter((x) => ids.includes(x.id));
    await pushChanges(slug, {
      members: pick(room.members, d.members),
      expenses: pick(room.expenses, d.expenses),
      payments: pick(room.payments, d.payments),
    });
    useMurmur.getState().clearDirty(slug, d);
    return true;
  };

  const run = async () => {
    if (!syncEnabled || busy.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setState('offline');
      return;
    }
    busy.current = true;
    setState('syncing');
    try {
      const remote = await pull();
      if (!remote) {
        // Room was created offline (or before sync was configured): publish it.
        const room = useMurmur.getState().rooms[slug];
        const creator = room?.members.find((m) => m.id === room.meId);
        if (room && creator) await createRemoteRoom(room.group, creator);
      }
      if (await push()) channel.current?.ping();
      setState('synced');
    } catch (err) {
      console.warn('[murmur] sync failed', err);
      setState('error');
    } finally {
      busy.current = false;
    }
  };

  // Initial pull + live channel.
  useEffect(() => {
    if (!syncEnabled || !hasRoom) return;
    void run();
    channel.current = subscribeRoom(slug, () => void pull().catch(() => setState('error')));
    const online = () => void run();
    const offline = () => setState('offline');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      channel.current?.close();
      channel.current = null;
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, hasRoom]);

  // Push local edits shortly after they happen.
  useEffect(() => {
    if (!syncEnabled || !dirty) return;
    if (!dirty.members.length && !dirty.expenses.length && !dirty.payments.length) return;
    const t = setTimeout(() => void run(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  return state;
}
