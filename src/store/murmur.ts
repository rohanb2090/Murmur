'use client';

import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import type { CaptureMode, Expense, Member, Payment, Room } from '@/lib/types';
import { parseExpense } from '@/lib/parser';
import { newId, newSlug } from '@/lib/id';
import { normaliseUpiId } from '@/lib/upi';

/** IndexedDB-backed storage so the ledger survives offline and reloads. */
const hasIdb = () => typeof indexedDB !== 'undefined';
const idbStorage: StateStorage = {
  getItem: async (name) => {
    if (!hasIdb()) return null; // server render / very old browsers
    try {
      return (await idbGet<string>(name)) ?? null;
    } catch {
      return null; // private mode or blocked storage: run in-memory
    }
  },
  setItem: async (name, value) => {
    if (hasIdb()) await idbSet(name, value).catch(() => undefined);
  },
  removeItem: async (name) => {
    if (hasIdb()) await idbDel(name).catch(() => undefined);
  },
};

export interface Dirty {
  members: string[];
  expenses: string[];
  payments: string[];
}

const emptyDirty = (): Dirty => ({ members: [], expenses: [], payments: [] });

export interface ExpensePatch {
  description?: string;
  amount?: number | null;
  paidBy?: string | null;
  splitAll?: boolean;
  splitMemberIds?: string[];
}

interface MurmurState {
  hydrated: boolean;
  deviceId: string;
  rooms: Record<string, Room>;
  /** Local changes not yet pushed to the cloud, per room slug. */
  dirty: Record<string, Dirty>;

  createRoom(input: { roomName: string; myName: string; upiId?: string }): string;
  joinRoom(room: Omit<Room, 'meId'>, me: { name: string; upiId?: string }): void;
  /** Adopt a room fetched from the cloud where this device is already a member. */
  adoptRoom(room: Room): void;
  leaveRoom(slug: string): void;

  addMember(slug: string, input: { name: string; upiId?: string; aliases?: string[] }): string;
  updateMember(slug: string, id: string, patch: Partial<Pick<Member, 'name' | 'upiId' | 'aliases' | 'deviceId'>>): void;

  capture(slug: string, rawInput: string, mode: CaptureMode): Expense | null;
  captureReceipt(
    slug: string,
    input: { rawInput: string; description: string; amount: number | null; confident: boolean; thumb: string | null },
  ): Expense | null;
  updateExpense(slug: string, id: string, patch: ExpensePatch): void;
  deleteExpense(slug: string, id: string): void;
  restoreExpense(slug: string, id: string): void;

  recordPayment(slug: string, input: { fromId: string; toId: string; amount: number }): string;
  undoPayment(slug: string, id: string): void;

  mergeRemote(slug: string, remote: Omit<Room, 'meId'>): void;
  clearDirty(slug: string, pushed: Dirty): void;
}

const now = () => Date.now();

function markDirty(dirty: Record<string, Dirty>, slug: string, kind: keyof Dirty, id: string): Record<string, Dirty> {
  const d = dirty[slug] ?? emptyDirty();
  if (d[kind].includes(id)) return dirty;
  return { ...dirty, [slug]: { ...d, [kind]: [...d[kind], id] } };
}

/** Last-write-wins merge by updatedAt; local unpushed edits always win. */
function mergeList<T extends { id: string; updatedAt: number }>(local: T[], remote: T[], keepLocal: Set<string>): T[] {
  const byId = new Map(local.map((x) => [x.id, x]));
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || (!keepLocal.has(r.id) && r.updatedAt > l.updatedAt)) byId.set(r.id, r);
  }
  return [...byId.values()];
}

function resolveStatus(e: Expense, members: Member[]): Pick<Expense, 'status' | 'issues'> {
  const issues: string[] = [];
  if (e.amount === null || e.amount <= 0) issues.push('No amount');
  if (!e.paidBy || !members.some((m) => m.id === e.paidBy)) issues.push('Who paid?');
  if (!e.splitAll && e.splitMemberIds.filter((id) => members.some((m) => m.id === id)).length === 0) issues.push('Split with whom?');
  return { status: issues.length ? 'unresolved' : 'resolved', issues };
}

export const useMurmur = create<MurmurState>()(
  persist(
    (set, get) => {
      const updateRoom = (slug: string, fn: (room: Room) => Room) => {
        const room = get().rooms[slug];
        if (!room) return;
        set({ rooms: { ...get().rooms, [slug]: fn(room) } });
      };

      const newMember = (groupId: string, input: { name: string; upiId?: string; aliases?: string[] }, deviceId: string | null): Member => ({
        id: newId(),
        groupId,
        name: input.name.trim(),
        aliases: (input.aliases ?? []).map((a) => a.trim()).filter(Boolean),
        upiId: input.upiId?.trim() ? normaliseUpiId(input.upiId) : null,
        deviceId,
        createdAt: now(),
        updatedAt: now(),
      });

      return {
        hydrated: false,
        deviceId: newId(),
        rooms: {},
        dirty: {},

        createRoom({ roomName, myName, upiId }) {
          const t = now();
          const slug = newSlug();
          const groupId = newId();
          const me = newMember(groupId, { name: myName, upiId }, get().deviceId);
          const room: Room = {
            group: { id: groupId, slug, name: roomName.trim(), createdAt: t, updatedAt: t },
            members: [me],
            expenses: [],
            payments: [],
            meId: me.id,
          };
          set({
            rooms: { ...get().rooms, [slug]: room },
            dirty: markDirty(get().dirty, slug, 'members', me.id),
          });
          return slug;
        },

        joinRoom(room, input) {
          const slug = room.group.slug;
          const me = newMember(room.group.id, input, get().deviceId);
          set({
            rooms: { ...get().rooms, [slug]: { ...room, members: [...room.members, me], meId: me.id } },
            dirty: markDirty(get().dirty, slug, 'members', me.id),
          });
        },

        adoptRoom(room) {
          set({ rooms: { ...get().rooms, [room.group.slug]: room } });
        },

        leaveRoom(slug) {
          const rooms = { ...get().rooms };
          const dirty = { ...get().dirty };
          delete rooms[slug];
          delete dirty[slug];
          set({ rooms, dirty });
        },

        addMember(slug, input) {
          const room = get().rooms[slug];
          if (!room) return '';
          const m = newMember(room.group.id, input, null);
          updateRoom(slug, (r) => ({ ...r, members: [...r.members, m] }));
          set({ dirty: markDirty(get().dirty, slug, 'members', m.id) });
          return m.id;
        },

        updateMember(slug, id, patch) {
          updateRoom(slug, (r) => ({
            ...r,
            members: r.members.map((m) =>
              m.id === id
                ? {
                    ...m,
                    ...patch,
                    name: patch.name?.trim() || m.name,
                    upiId: patch.upiId === undefined ? m.upiId : patch.upiId ? normaliseUpiId(patch.upiId) : null,
                    updatedAt: now(),
                  }
                : m,
            ),
          }));
          set({ dirty: markDirty(get().dirty, slug, 'members', id) });
        },

        capture(slug, rawInput, mode) {
          const room = get().rooms[slug];
          const text = rawInput.trim();
          if (!room || !text) return null;
          const parsed = parseExpense(text, room.members, room.meId);
          const t = now();
          const e: Expense = {
            id: newId(),
            groupId: room.group.id,
            rawInput: text,
            captureMode: mode,
            description: parsed.description,
            amount: parsed.amount,
            paidBy: parsed.paidBy,
            splitAll: parsed.splitAll,
            splitMemberIds: parsed.splitMemberIds,
            status: parsed.status,
            issues: parsed.issues,
            receiptThumb: null,
            createdBy: room.meId,
            createdAt: t,
            updatedAt: t,
            deletedAt: null,
          };
          updateRoom(slug, (r) => ({ ...r, expenses: [e, ...r.expenses] }));
          set({ dirty: markDirty(get().dirty, slug, 'expenses', e.id) });
          return e;
        },

        captureReceipt(slug, input) {
          const room = get().rooms[slug];
          if (!room) return null;
          const t = now();
          const issues: string[] = [];
          if (input.amount === null) issues.push("Couldn't read a total");
          else if (!input.confident) issues.push('Check the total');
          const e: Expense = {
            id: newId(),
            groupId: room.group.id,
            rawInput: input.rawInput,
            captureMode: 'ocr',
            description: input.description || 'Receipt',
            amount: input.amount,
            paidBy: room.meId,
            splitAll: true,
            splitMemberIds: [],
            status: issues.length ? 'unresolved' : 'resolved',
            issues,
            receiptThumb: input.thumb,
            createdBy: room.meId,
            createdAt: t,
            updatedAt: t,
            deletedAt: null,
          };
          updateRoom(slug, (r) => ({ ...r, expenses: [e, ...r.expenses] }));
          set({ dirty: markDirty(get().dirty, slug, 'expenses', e.id) });
          return e;
        },

        updateExpense(slug, id, patch) {
          updateRoom(slug, (r) => ({
            ...r,
            expenses: r.expenses.map((e) => {
              if (e.id !== id) return e;
              const next: Expense = { ...e, ...patch, updatedAt: now() };
              if (next.splitAll) next.splitMemberIds = [];
              return { ...next, ...resolveStatus(next, r.members) };
            }),
          }));
          set({ dirty: markDirty(get().dirty, slug, 'expenses', id) });
        },

        deleteExpense(slug, id) {
          updateRoom(slug, (r) => ({
            ...r,
            expenses: r.expenses.map((e) => (e.id === id ? { ...e, deletedAt: now(), updatedAt: now() } : e)),
          }));
          set({ dirty: markDirty(get().dirty, slug, 'expenses', id) });
        },

        restoreExpense(slug, id) {
          updateRoom(slug, (r) => ({
            ...r,
            expenses: r.expenses.map((e) => (e.id === id ? { ...e, deletedAt: null, updatedAt: now() } : e)),
          }));
          set({ dirty: markDirty(get().dirty, slug, 'expenses', id) });
        },

        recordPayment(slug, { fromId, toId, amount }) {
          const room = get().rooms[slug];
          if (!room) return '';
          const t = now();
          const p: Payment = { id: newId(), groupId: room.group.id, fromId, toId, amount, createdAt: t, updatedAt: t, deletedAt: null };
          updateRoom(slug, (r) => ({ ...r, payments: [p, ...r.payments] }));
          set({ dirty: markDirty(get().dirty, slug, 'payments', p.id) });
          return p.id;
        },

        undoPayment(slug, id) {
          updateRoom(slug, (r) => ({
            ...r,
            payments: r.payments.map((p) => (p.id === id ? { ...p, deletedAt: now(), updatedAt: now() } : p)),
          }));
          set({ dirty: markDirty(get().dirty, slug, 'payments', id) });
        },

        mergeRemote(slug, remote) {
          const local = get().rooms[slug];
          if (!local) return;
          const d = get().dirty[slug] ?? emptyDirty();
          const members = mergeList(local.members, remote.members, new Set(d.members));
          const expenses = mergeList(local.expenses, remote.expenses, new Set(d.expenses)).sort((a, b) => b.createdAt - a.createdAt);
          const payments = mergeList(local.payments, remote.payments, new Set(d.payments)).sort((a, b) => b.createdAt - a.createdAt);
          const group = remote.group.updatedAt > local.group.updatedAt ? remote.group : local.group;
          set({ rooms: { ...get().rooms, [slug]: { ...local, group, members, expenses, payments } } });
        },

        clearDirty(slug, pushed) {
          const d = get().dirty[slug];
          if (!d) return;
          const left: Dirty = {
            members: d.members.filter((id) => !pushed.members.includes(id)),
            expenses: d.expenses.filter((id) => !pushed.expenses.includes(id)),
            payments: d.payments.filter((id) => !pushed.payments.includes(id)),
          };
          set({ dirty: { ...get().dirty, [slug]: left } });
        },
      };
    },
    {
      name: 'murmur:v1',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ deviceId: s.deviceId, rooms: s.rooms, dirty: s.dirty }),
      onRehydrateStorage: () => () => {
        useMurmur.setState({ hydrated: true });
      },
    },
  ),
);
