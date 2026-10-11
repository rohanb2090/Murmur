'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Keyboard, ScanText, Trash2, Check } from 'lucide-react';
import type { Expense, Member, Room } from '@/lib/types';
import { breakdown, relativeTime, memberLabel } from '@/lib/format';
import { formatINR, parseRupeeInput } from '@/lib/money';
import { useMurmur } from '@/store/murmur';
import { toast } from './Toaster';

const MODE_ICON = { voice: Mic, text: Keyboard, ocr: ScanText } as const;

interface Props {
  room: Room;
  filter: 'all' | 'unresolved';
  onFilter(f: 'all' | 'unresolved'): void;
  freshId: string | null;
}

export function Dump({ room, filter, onFilter, freshId }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [, tick] = useState(0);

  // Keep relative timestamps fresh.
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const live = room.expenses.filter((e) => e.deletedAt === null);
  const unresolved = live.filter((e) => e.status === 'unresolved');
  const shown = filter === 'unresolved' ? unresolved : live;

  if (live.length === 0) {
    return (
      <div className="px-5 pt-14 text-center">
        <p className="font-display text-[26px] font-semibold leading-tight">Nothing logged yet</p>
        <p className="mx-auto mt-3 max-w-[30ch] text-[15px] leading-relaxed text-muted">
          Hold the mic and say what you paid for, like <span className="text-text">“auto 140 with Kabir”</span>. Sort out the details later.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2 px-5 pt-3 pb-1">
        <FilterChip active={filter === 'all'} onClick={() => onFilter('all')}>
          Everything <span className="text-faint">{live.length}</span>
        </FilterChip>
        <FilterChip active={filter === 'unresolved'} onClick={() => onFilter('unresolved')} disabled={!unresolved.length}>
          Needs details{' '}
          <span className={unresolved.length ? 'font-semibold text-accent-strong' : 'text-faint'}>{unresolved.length}</span>
        </FilterChip>
      </div>

      {shown.length === 0 && <p className="px-5 pt-10 text-center text-muted">Every entry has an amount, a payer and a split.</p>}

      <ul>
        {shown.map((e) => (
          <li key={e.id} className={e.id === freshId ? 'land' : undefined}>
            <ExpenseRow
              expense={e}
              room={room}
              open={openId === e.id}
              onToggle={() => setOpenId(openId === e.id ? null : e.id)}
              onDone={() => setOpenId(null)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FilterChip({ active, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      {...rest}
      className={`min-h-10 rounded-full px-4 text-[14px] transition-colors disabled:opacity-50 ${
        active ? 'bg-text text-bg' : 'bg-sunk text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}

function ExpenseRow({ expense: e, room, open, onToggle, onDone }: { expense: Expense; room: Room; open: boolean; onToggle(): void; onDone(): void }) {
  const Icon = MODE_ICON[e.captureMode];
  const unresolved = e.status === 'unresolved';
  return (
    <div className={`relative border-b border-line ${open ? 'bg-surface' : ''}`}>
      {unresolved && <span className="absolute top-4 bottom-4 left-0 w-[3px] rounded-r bg-accent" aria-hidden />}
      <button onClick={onToggle} aria-expanded={open} className="flex w-full gap-3 px-5 py-4 text-left">
        {e.receiptThumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={e.receiptThumb} alt="" className="h-14 w-11 shrink-0 rounded-lg object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[17px] font-semibold">{e.description || 'Expense'}</span>
            <span className={`num shrink-0 text-[24px] font-bold ${unresolved && e.amount === null ? 'text-accent-strong' : ''}`}>
              {e.amount === null ? '₹ ?' : formatINR(e.amount)}
            </span>
          </div>
          <p className="mt-0.5 text-[13.5px] text-muted">{breakdown(e, room.members, room.meId)}</p>
          {unresolved && e.issues.length > 0 && <p className="mt-1 text-[13.5px] font-medium text-accent-strong">{e.issues.join(' · ')} — tap to fix</p>}
          <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-faint">
            <Icon className="h-3.5 w-3.5 shrink-0" aria-label={e.captureMode} />
            <span className="truncate italic">“{e.rawInput.split('\n')[0]}”</span>
            <span className="shrink-0">· {relativeTime(e.createdAt)}</span>
          </p>
        </div>
      </button>
      {open && <ExpenseEditor expense={e} room={room} onDone={onDone} />}
    </div>
  );
}

function ExpenseEditor({ expense: e, room, onDone }: { expense: Expense; room: Room; onDone(): void }) {
  const update = useMurmur((s) => s.updateExpense);
  const remove = useMurmur((s) => s.deleteExpense);
  const restore = useMurmur((s) => s.restoreExpense);
  const slug = room.group.slug;

  const [amount, setAmount] = useState(e.amount === null ? '' : String(e.amount / 100));
  const [description, setDescription] = useState(e.description);
  const [paidBy, setPaidBy] = useState<string | null>(e.paidBy);
  const [splitAll, setSplitAll] = useState(e.splitAll);
  const [splitIds, setSplitIds] = useState<string[]>(e.splitAll ? [] : e.splitMemberIds);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (e.amount === null) amountRef.current?.focus();
  }, [e.amount]);

  const members = useMemo(
    () => [...room.members].sort((a, b) => (a.id === room.meId ? -1 : b.id === room.meId ? 1 : a.name.localeCompare(b.name))),
    [room.members, room.meId],
  );
  const parsedAmount = parseRupeeInput(amount);
  const valid = parsedAmount !== null && paidBy !== null && (splitAll || splitIds.length > 0);

  const toggleSplit = (id: string) => {
    if (splitAll) {
      setSplitAll(false);
      setSplitIds(members.map((m) => m.id).filter((x) => x !== id));
      return;
    }
    const next = splitIds.includes(id) ? splitIds.filter((x) => x !== id) : [...splitIds, id];
    if (next.length === members.length) {
      setSplitAll(true);
      setSplitIds([]);
    } else setSplitIds(next);
  };

  const save = () => {
    update(slug, e.id, {
      amount: parsedAmount,
      description: description.trim() || 'Expense',
      paidBy,
      splitAll,
      splitMemberIds: splitAll ? [] : splitIds,
    });
    toast(valid ? 'Saved' : 'Saved — still needs details', { tone: valid ? 'default' : 'warn' });
    onDone();
  };

  return (
    <div className="rise space-y-5 px-5 pb-5">
      <div className="flex gap-3">
        <label className="w-[38%]">
          <span className="mb-1.5 block text-[13px] text-muted">Amount</span>
          <div className={`flex h-12 items-center rounded-xl bg-sunk px-3 ${amount && parsedAmount === null ? 'ring-2 ring-owe' : ''}`}>
            <span className="num mr-1 text-muted">₹</span>
            <input
              ref={amountRef}
              inputMode="decimal"
              value={amount}
              onChange={(ev) => setAmount(ev.target.value)}
              className="num w-full min-w-0 bg-transparent text-[20px] font-bold outline-none"
              aria-label="Amount in rupees"
            />
          </div>
        </label>
        <label className="flex-1">
          <span className="mb-1.5 block text-[13px] text-muted">What for</span>
          <input
            value={description}
            onChange={(ev) => setDescription(ev.target.value)}
            maxLength={60}
            className="h-12 w-full rounded-xl bg-sunk px-3 text-[16px] outline-none"
          />
        </label>
      </div>

      <fieldset>
        <legend className="mb-2 text-[13px] text-muted">Paid by</legend>
        <div className="flex flex-wrap gap-2">
          {members.map((m) => (
            <Chip key={m.id} active={paidBy === m.id} onClick={() => setPaidBy(m.id)}>
              {memberLabel(m.id, room.members, room.meId)}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-[13px] text-muted">Split between</legend>
        <div className="flex flex-wrap gap-2">
          <Chip
            active={splitAll}
            onClick={() => {
              setSplitAll(true);
              setSplitIds([]);
            }}
          >
            Everyone ({members.length})
          </Chip>
          {members.map((m) => (
            <Chip key={m.id} active={!splitAll && splitIds.includes(m.id)} onClick={() => toggleSplit(m.id)}>
              {memberLabel(m.id, room.members, room.meId)}
            </Chip>
          ))}
        </div>
        {!splitAll && splitIds.length > 0 && parsedAmount !== null && (
          <p className="mt-2 text-[13px] text-muted">{formatINR(Math.round(parsedAmount / splitIds.length))} each, roughly</p>
        )}
      </fieldset>

      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          onClick={() => {
            remove(slug, e.id);
            onDone();
            toast('Entry deleted', { action: { label: 'Undo', run: () => restore(slug, e.id) } });
          }}
          className="flex min-h-12 items-center gap-2 rounded-xl px-3 text-[15px] text-owe hover:bg-sunk"
        >
          <Trash2 className="h-4 w-4" /> Delete
        </button>
        <div className="flex gap-2">
          <button onClick={onDone} className="min-h-12 rounded-xl px-4 text-[15px] text-muted hover:bg-sunk">
            Cancel
          </button>
          <button onClick={save} className="flex min-h-12 items-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-semibold text-on-accent">
            <Check className="h-4 w-4" /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function Chip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 rounded-full px-4 text-[15px] transition-colors ${
        active ? 'bg-text font-semibold text-bg' : 'bg-sunk text-text hover:bg-line'
      }`}
    >
      {children}
    </button>
  );
}

export type { Member };
