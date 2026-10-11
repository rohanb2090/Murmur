'use client';

import { useState } from 'react';
import { UserPlus, Pencil } from 'lucide-react';
import type { Member, Room } from '@/lib/types';
import { computeSummaries } from '@/lib/ledger';
import { formatINR } from '@/lib/money';
import { initials } from '@/lib/format';
import { isValidUpiId } from '@/lib/upi';
import { useMurmur } from '@/store/murmur';
import { toast } from './Toaster';

export function Balances({ room }: { room: Room }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const summaries = computeSummaries(room.members, room.expenses, room.payments);
  const max = Math.max(1, ...summaries.map((s) => Math.abs(s.net)));

  return (
    <div className="px-5 pt-4">
      <ul>
        {summaries.map((s) => {
          const m = room.members.find((x) => x.id === s.memberId)!;
          const isMe = m.id === room.meId;
          if (editing === m.id) {
            return (
              <li key={m.id} className="border-b border-line py-4">
                <MemberForm room={room} member={m} onDone={() => setEditing(null)} />
              </li>
            );
          }
          return (
            <li key={m.id} className="border-b border-line py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sunk text-[14px] font-semibold">
                  {initials(m.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-semibold">
                    {m.name}
                    {isMe && <span className="font-normal text-muted"> (you)</span>}
                  </p>
                  <p className="text-[13px] text-muted">
                    Paid {formatINR(s.paid)} · share {formatINR(s.share)}
                    {!m.upiId && <span className="text-accent-strong"> · no UPI ID</span>}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`num text-[20px] font-bold ${s.net > 0 ? 'text-owed' : s.net < 0 ? 'text-owe' : 'text-muted'}`}>
                    {s.net === 0 ? '—' : formatINR(s.net, { sign: true })}
                  </p>
                  <p className="text-[12px] text-faint">{s.net > 0 ? 'gets back' : s.net < 0 ? 'owes' : 'settled'}</p>
                </div>
                <button aria-label={`Edit ${m.name}`} onClick={() => setEditing(m.id)} className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-sunk">
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
              {/* Net position bar: right of centre = owed, left = owes */}
              <div className="relative mt-3 ml-14 h-1.5 rounded-full bg-sunk" aria-hidden>
                <span
                  className={`absolute top-0 h-full rounded-full ${s.net >= 0 ? 'left-1/2 bg-owed' : 'right-1/2 bg-owe'}`}
                  style={{ width: `${(Math.abs(s.net) / max) * 50}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="py-5">
        {editing === 'new' ? (
          <MemberForm room={room} onDone={() => setEditing(null)} />
        ) : (
          <button onClick={() => setEditing('new')} className="flex min-h-12 items-center gap-2 rounded-xl px-1 text-[15px] font-semibold text-accent-strong">
            <UserPlus className="h-5 w-5" /> Add someone
          </button>
        )}
        <p className="mt-2 text-[13px] leading-relaxed text-faint">
          Add flatmates who won’t use the app. Aliases help voice capture — add how it tends to spell their name (“Kabbu”, “Kabeer”).
        </p>
      </div>
    </div>
  );
}

function MemberForm({ room, member, onDone }: { room: Room; member?: Member; onDone(): void }) {
  const add = useMurmur((s) => s.addMember);
  const update = useMurmur((s) => s.updateMember);
  const [name, setName] = useState(member?.name ?? '');
  const [upi, setUpi] = useState(member?.upiId ?? '');
  const [aliases, setAliases] = useState((member?.aliases ?? []).join(', '));
  const upiBad = upi.trim() !== '' && !isValidUpiId(upi);
  const dupe = room.members.some((m) => m.id !== member?.id && m.name.trim().toLowerCase() === name.trim().toLowerCase());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || upiBad || dupe) return;
    const input = { name, upiId: upi.trim() || undefined, aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean) };
    if (member) {
      update(room.group.slug, member.id, { name, upiId: upi.trim() || null, aliases: input.aliases });
      toast('Saved');
    } else {
      add(room.group.slug, input);
      toast(`Added ${name.trim()}`);
    }
    onDone();
  };

  return (
    <form onSubmit={submit} className="rise space-y-3">
      <Field label="Name" error={dupe ? 'Someone in this room already has that name' : undefined}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required className="h-12 w-full rounded-xl bg-sunk px-3 text-[16px] outline-none" />
      </Field>
      <Field label="UPI ID (optional)" error={upiBad ? 'Looks like name@bank, e.g. kabir@okicici' : undefined}>
        <input
          value={upi}
          onChange={(e) => setUpi(e.target.value)}
          inputMode="email"
          autoCapitalize="none"
          placeholder="kabir@okicici"
          className="h-12 w-full rounded-xl bg-sunk px-3 text-[16px] outline-none placeholder:text-faint"
        />
      </Field>
      <Field label="Also called (comma separated)">
        <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="kabbu, kabeer" className="h-12 w-full rounded-xl bg-sunk px-3 text-[16px] outline-none placeholder:text-faint" />
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onDone} className="min-h-12 rounded-xl px-4 text-muted hover:bg-sunk">
          Cancel
        </button>
        <button type="submit" className="min-h-12 rounded-xl bg-accent px-5 font-semibold text-on-accent">
          {member ? 'Save' : 'Add'}
        </button>
      </div>
    </form>
  );
}

export function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] text-muted">{label}</span>
      {children}
      {error && <span className="mt-1 block text-[13px] text-owe">{error}</span>}
    </label>
  );
}
