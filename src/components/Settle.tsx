'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy, Share2, ArrowRight, CircleCheck, IndianRupee } from 'lucide-react';
import type { Room } from '@/lib/types';
import { computeSummaries, simplifyDebts, totalSpend, isCountable } from '@/lib/ledger';
import { formatINR } from '@/lib/money';
import { memberLabel, relativeTime } from '@/lib/format';
import { buildUpiUri } from '@/lib/upi';
import { renderSettlementCard, settlementSummaryText, shareCanvas, type CardInput } from '@/lib/settlementCard';
import { useMurmur } from '@/store/murmur';
import { toast } from './Toaster';

export function Settle({ room, onReview }: { room: Room; onReview(): void }) {
  const record = useMurmur((s) => s.recordPayment);
  const undo = useMurmur((s) => s.undoPayment);
  const slug = room.group.slug;

  const card: CardInput = useMemo(() => {
    const summaries = computeSummaries(room.members, room.expenses, room.payments);
    return {
      groupName: room.group.name,
      total: totalSpend(room.expenses),
      entryCount: room.expenses.filter(isCountable).length,
      members: room.members,
      summaries,
      transfers: simplifyDebts(Object.fromEntries(summaries.map((s) => [s.memberId, s.net]))),
    };
  }, [room]);

  const [preview, setPreview] = useState<string | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let alive = true;
    renderSettlementCard(card)
      .then((c) => {
        if (!alive) return;
        setCanvas(c);
        setPreview(c.toDataURL('image/png'));
      })
      .catch((err) => console.warn('[murmur] card render failed', err));
    return () => {
      alive = false;
    };
  }, [card]);

  const unresolved = room.expenses.filter((e) => e.deletedAt === null && e.status === 'unresolved').length;
  const payments = room.payments.filter((p) => p.deletedAt === null);
  const name = (id: string) => memberLabel(id, room.members, room.meId);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(settlementSummaryText(card));
      toast('Summary copied');
    } catch {
      toast("Couldn't copy. Long-press the card image to share it instead.", { tone: 'warn' });
    }
  };

  const share = async () => {
    if (!canvas) return;
    try {
      const result = await shareCanvas(canvas, `${room.group.name.replace(/\W+/g, '-').toLowerCase() || 'murmur'}-settle-up.png`, settlementSummaryText(card));
      if (result === 'downloaded') toast('Image saved to downloads');
    } catch {
      toast("Couldn't share the image", { tone: 'warn' });
    }
  };

  return (
    <div className="px-5 pt-4">
      {unresolved > 0 && (
        <button onClick={onReview} className="mb-4 flex w-full items-center justify-between gap-3 rounded-2xl bg-sunk px-4 py-3 text-left">
          <span className="text-[14.5px]">
            <span className="font-semibold text-accent-strong">
              {unresolved} {unresolved === 1 ? 'entry needs' : 'entries need'} details
            </span>{' '}
            and {unresolved === 1 ? "isn't" : "aren't"} counted yet.
          </span>
          <span className="shrink-0 text-[14px] font-semibold">Review</span>
        </button>
      )}

      <p className="text-[14px] text-muted">
        Total spend <span className="num text-[15px] font-bold text-text">{formatINR(card.total)}</span> across {card.entryCount}{' '}
        {card.entryCount === 1 ? 'entry' : 'entries'}
      </p>

      {card.transfers.length === 0 ? (
        <div className="py-12 text-center">
          <CircleCheck className="mx-auto h-10 w-10 text-owed" />
          <p className="font-display mt-3 text-[24px] font-semibold">All square</p>
          <p className="mt-1 text-muted">Nobody owes anything right now.</p>
        </div>
      ) : (
        <ul className="mt-3">
          {card.transfers.map((t) => {
            const payee = room.members.find((m) => m.id === t.to);
            const iPay = t.from === room.meId;
            return (
              <li key={`${t.from}-${t.to}`} className="border-b border-line py-4">
                <div className="flex items-center gap-2 text-[16px]">
                  <span className="font-semibold">{name(t.from)}</span>
                  <ArrowRight className="h-4 w-4 text-faint" aria-label="pays" />
                  <span className="font-semibold">{name(t.to)}</span>
                  <span className="num ml-auto text-[24px] font-bold">{formatINR(t.amount)}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {iPay && payee?.upiId && (
                    <a
                      href={buildUpiUri({ upiId: payee.upiId, payeeName: payee.name, amount: t.amount, groupName: room.group.name })}
                      className="flex min-h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-[14.5px] font-semibold text-on-accent"
                    >
                      <IndianRupee className="h-4 w-4" /> Pay with UPI
                    </a>
                  )}
                  <button
                    onClick={() => {
                      const id = record(slug, { fromId: t.from, toId: t.to, amount: t.amount });
                      toast(`Marked ${formatINR(t.amount)} as paid`, { action: { label: 'Undo', run: () => undo(slug, id) } });
                    }}
                    className="min-h-11 rounded-xl bg-sunk px-4 text-[14.5px] font-semibold"
                  >
                    Mark as paid
                  </button>
                </div>
                {!payee?.upiId && <p className="mt-2 text-[13px] text-faint">{name(t.to)} hasn’t added a UPI ID, so the card won’t have a QR for this one.</p>}
              </li>
            );
          })}
        </ul>
      )}

      <section className="mt-6" aria-label="Shareable settlement card">
        <div className="flex gap-2">
          <button onClick={share} disabled={!canvas} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-text font-semibold text-bg disabled:opacity-50">
            <Share2 className="h-4 w-4" /> Share image
          </button>
          <button onClick={copy} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-sunk font-semibold">
            <Copy className="h-4 w-4" /> Copy summary
          </button>
        </div>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Settlement card with UPI QR codes" className="mt-4 w-full rounded-2xl shadow-[var(--shadow)]" />
        ) : (
          <div className="mt-4 aspect-[4/5] w-full animate-pulse rounded-2xl bg-sunk" />
        )}
      </section>

      {payments.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-[18px] font-semibold">Paid back</h2>
          <ul className="mt-2">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center gap-2 border-b border-line py-3 text-[15px]">
                <span>
                  {name(p.fromId)} paid {name(p.toId)} <span className="num font-bold">{formatINR(p.amount)}</span>
                </span>
                <span className="ml-auto text-[13px] text-faint">{relativeTime(p.createdAt)}</span>
                <button onClick={() => undo(slug, p.id)} className="min-h-10 rounded-lg px-2 text-[13px] text-muted hover:bg-sunk">
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
