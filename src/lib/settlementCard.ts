'use client';

import QRCode from 'qrcode';
import type { Member, Paise } from './types';
import type { MemberSummary, Transfer } from './ledger';
import { formatINR } from './money';
import { buildUpiUri } from './upi';

export interface CardInput {
  groupName: string;
  total: Paise;
  entryCount: number;
  members: Member[];
  summaries: MemberSummary[];
  transfers: Transfer[];
}

const W = 1080;
const PAD = 72;
const C = {
  bg: '#15183a',
  panel: '#1d2148',
  line: 'rgba(236,234,255,0.12)',
  text: '#f1efff',
  muted: '#a6a8cc',
  accent: '#f5b544',
  owed: '#52d6a0',
  owe: '#ff8193',
};
const DISPLAY = '"Bricolage Grotesque Variable", system-ui, sans-serif';
const SANS = '"Instrument Sans Variable", system-ui, sans-serif';

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

async function qrCanvas(data: string, size: number): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas');
  await QRCode.toCanvas(c, data, { width: size, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#15183a', light: '#ffffff' } });
  return c;
}

export async function renderSettlementCard(input: CardInput): Promise<HTMLCanvasElement> {
  await Promise.all([
    document.fonts?.load(`700 64px ${DISPLAY}`),
    document.fonts?.load(`500 30px ${SANS}`),
  ]).catch(() => undefined);

  const name = (id: string) => input.members.find((m) => m.id === id)?.name ?? 'Someone';
  const QR = 232;
  const rowH = (t: Transfer) => (input.members.find((m) => m.id === t.to)?.upiId ? QR + 64 : 132);
  const transfersH = input.transfers.length ? input.transfers.reduce((s, t) => s + rowH(t), 0) + 90 : 150;
  const balancesH = 90 + input.summaries.length * 64;
  const H = PAD + 250 + transfersH + balancesH + 120;

  const scale = 1;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Header
  let y = PAD;
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.arc(PAD + 14, y + 14, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.muted;
  ctx.font = `600 28px ${SANS}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('Murmur settle-up', PAD + 44, y + 15);

  y += 92;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.text;
  ctx.font = `700 76px ${DISPLAY}`;
  ctx.fillText(fitText(ctx, input.groupName, W - PAD * 2), PAD, y);

  y += 64;
  ctx.font = `500 32px ${SANS}`;
  ctx.fillStyle = C.muted;
  const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  ctx.fillText(`${formatINR(input.total)} spent across ${input.entryCount} ${input.entryCount === 1 ? 'entry' : 'entries'} · ${date}`, PAD, y);

  y += 94;
  ctx.fillStyle = C.text;
  ctx.font = `700 40px ${DISPLAY}`;
  ctx.fillText(input.transfers.length ? 'To settle up' : 'All square', PAD, y);
  y += 36;

  if (!input.transfers.length) {
    ctx.font = `500 30px ${SANS}`;
    ctx.fillStyle = C.muted;
    ctx.fillText('Nobody owes anybody anything.', PAD, y + 30);
    y += 114;
  }

  for (const t of input.transfers) {
    const payee = input.members.find((m) => m.id === t.to);
    const h = rowH(t);
    ctx.fillStyle = C.panel;
    ctx.beginPath();
    ctx.roundRect(PAD, y, W - PAD * 2, h - 24, 28);
    ctx.fill();

    const hasQr = Boolean(payee?.upiId);
    const textX = PAD + 36;
    const textW = W - PAD * 2 - 72 - (hasQr ? QR + 24 : 0);
    ctx.fillStyle = C.text;
    ctx.font = `600 34px ${SANS}`;
    ctx.fillText(fitText(ctx, `${name(t.from)} pays ${name(t.to)}`, textW), textX, y + 62);
    ctx.fillStyle = C.accent;
    ctx.font = `700 60px ${DISPLAY}`;
    ctx.fillText(formatINR(t.amount), textX, y + 132);

    if (hasQr && payee?.upiId) {
      const uri = buildUpiUri({ upiId: payee.upiId, payeeName: payee.name, amount: t.amount, groupName: input.groupName });
      const qr = await qrCanvas(uri, QR);
      const qx = W - PAD - 24 - QR;
      ctx.drawImage(qr, qx, y + 20);
      ctx.fillStyle = C.muted;
      ctx.font = `500 26px ${SANS}`;
      ctx.fillText(fitText(ctx, `UPI · ${payee.upiId}`, textW), textX, y + 186);
      ctx.fillText('Scan with any UPI app', textX, y + 222);
    } else {
      ctx.fillStyle = C.muted;
      ctx.font = `500 26px ${SANS}`;
      ctx.fillText(`${name(t.to)} hasn't added a UPI ID`, textX + 260, y + 128);
    }
    y += h;
  }

  // Balances
  y += 40;
  ctx.fillStyle = C.text;
  ctx.font = `700 40px ${DISPLAY}`;
  ctx.fillText('Where everyone stands', PAD, y);
  y += 30;
  for (const s of input.summaries) {
    y += 64;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, y - 46);
    ctx.lineTo(W - PAD, y - 46);
    ctx.stroke();
    ctx.fillStyle = C.text;
    ctx.font = `500 32px ${SANS}`;
    ctx.fillText(fitText(ctx, name(s.memberId), 520), PAD, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = s.net > 0 ? C.owed : s.net < 0 ? C.owe : C.muted;
    ctx.font = `700 36px ${DISPLAY}`;
    ctx.fillText(s.net === 0 ? 'settled' : s.net > 0 ? `gets ${formatINR(s.net)}` : `owes ${formatINR(-s.net)}`, W - PAD, y);
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = C.muted;
  ctx.font = `500 24px ${SANS}`;
  ctx.fillText('Logged by voice, receipt and text with Murmur', PAD, H - PAD + 10);
  return canvas;
}

export function settlementSummaryText(input: CardInput): string {
  const name = (id: string) => input.members.find((m) => m.id === id)?.name ?? 'Someone';
  const lines = [`${input.groupName} — settle-up`, `${formatINR(input.total)} spent across ${input.entryCount} entries`, ''];
  if (!input.transfers.length) lines.push('All square. Nobody owes anything.');
  for (const t of input.transfers) {
    const upi = input.members.find((m) => m.id === t.to)?.upiId;
    lines.push(`• ${name(t.from)} pays ${name(t.to)} ${formatINR(t.amount)}${upi ? ` (UPI: ${upi})` : ''}`);
  }
  return lines.join('\n');
}

export async function shareCanvas(canvas: HTMLCanvasElement, filename: string, text: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not create the image');
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
