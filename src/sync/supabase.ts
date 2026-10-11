'use client';

/**
 * Cloud sync through Supabase. Every call goes through SECURITY DEFINER RPCs
 * that take the room slug as the capability token (see supabase/schema.sql);
 * the anon key cannot read tables directly.
 *
 * Sync is off unless NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
 * are set — Murmur then runs as a single-device, offline ledger.
 */
import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import type { Expense, Group, Member, Payment, Room } from '@/lib/types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const syncEnabled = Boolean(url && anonKey);

let client: SupabaseClient | null = null;
function supabase(): SupabaseClient {
  if (!syncEnabled) throw new Error('Cloud sync is not configured');
  client ??= createClient(url!, anonKey!, { auth: { persistSession: false } });
  return client;
}

// ── Row mappers (snake_case in Postgres ↔ camelCase in the app) ───────────
type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const groupFrom = (r: Row): Group => ({
  id: r.id as string,
  slug: r.slug as string,
  name: r.name as string,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});
const memberFrom = (r: Row): Member => ({
  id: r.id as string,
  groupId: r.group_id as string,
  name: r.name as string,
  aliases: (r.aliases as string[]) ?? [],
  upiId: (r.upi_id as string) ?? null,
  deviceId: (r.device_id as string) ?? null,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});
const memberTo = (m: Member): Row => ({
  id: m.id, group_id: m.groupId, name: m.name, aliases: m.aliases, upi_id: m.upiId, device_id: m.deviceId,
  created_at: m.createdAt, updated_at: m.updatedAt,
});
const expenseFrom = (r: Row): Expense => ({
  id: r.id as string,
  groupId: r.group_id as string,
  rawInput: r.raw_input as string,
  captureMode: r.capture_mode as Expense['captureMode'],
  description: (r.description as string) ?? '',
  amount: num(r.amount_paise),
  paidBy: (r.paid_by as string) ?? null,
  splitAll: Boolean(r.split_all),
  splitMemberIds: (r.split_member_ids as string[]) ?? [],
  status: r.status as Expense['status'],
  issues: (r.issues as string[]) ?? [],
  receiptThumb: (r.receipt_thumb as string) ?? null,
  createdBy: (r.created_by as string) ?? null,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
  deletedAt: num(r.deleted_at),
});
const expenseTo = (e: Expense): Row => ({
  id: e.id, group_id: e.groupId, raw_input: e.rawInput, capture_mode: e.captureMode, description: e.description,
  amount_paise: e.amount, paid_by: e.paidBy, split_all: e.splitAll, split_member_ids: e.splitMemberIds, status: e.status,
  issues: e.issues, receipt_thumb: e.receiptThumb, created_by: e.createdBy, created_at: e.createdAt, updated_at: e.updatedAt,
  deleted_at: e.deletedAt,
});
const paymentFrom = (r: Row): Payment => ({
  id: r.id as string,
  groupId: r.group_id as string,
  fromId: r.from_id as string,
  toId: r.to_id as string,
  amount: Number(r.amount_paise),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
  deletedAt: num(r.deleted_at),
});
const paymentTo = (p: Payment): Row => ({
  id: p.id, group_id: p.groupId, from_id: p.fromId, to_id: p.toId, amount_paise: p.amount,
  created_at: p.createdAt, updated_at: p.updatedAt, deleted_at: p.deletedAt,
});

export type RemoteRoom = Omit<Room, 'meId'>;

export async function fetchRoom(slug: string): Promise<RemoteRoom | null> {
  const { data, error } = await supabase().rpc('get_room', { p_slug: slug });
  if (error) throw error;
  if (!data) return null;
  const d = data as { group: Row; members: Row[]; expenses: Row[]; payments: Row[] };
  return {
    group: groupFrom(d.group),
    members: (d.members ?? []).map(memberFrom),
    expenses: (d.expenses ?? []).map(expenseFrom),
    payments: (d.payments ?? []).map(paymentFrom),
  };
}

export async function createRemoteRoom(group: Group, creator: Member): Promise<void> {
  const { error } = await supabase().rpc('create_room', {
    p_group: { id: group.id, slug: group.slug, name: group.name, created_at: group.createdAt, updated_at: group.updatedAt },
    p_member: memberTo(creator),
  });
  if (error) throw error;
}

export async function pushChanges(slug: string, changes: { members: Member[]; expenses: Expense[]; payments: Payment[] }) {
  const { error } = await supabase().rpc('push_changes', {
    p_slug: slug,
    p_members: changes.members.map(memberTo),
    p_expenses: changes.expenses.map(expenseTo),
    p_payments: changes.payments.map(paymentTo),
  });
  if (error) throw error;
}

/**
 * Lightweight live updates: devices ping a broadcast channel named after the
 * slug after each push; listeners re-pull. No row data travels over the channel.
 */
export function subscribeRoom(slug: string, onChange: () => void): { ping(): void; close(): void } {
  const channel: RealtimeChannel = supabase().channel(`room:${slug}`, { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'changed' }, onChange).subscribe();
  return {
    ping: () => void channel.send({ type: 'broadcast', event: 'changed', payload: {} }),
    close: () => void supabase().removeChannel(channel),
  };
}
