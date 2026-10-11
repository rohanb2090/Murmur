'use client';

/**
 * In-browser OCR with Tesseract.js. The worker, wasm core and English model
 * are served from /tesseract (copied there by scripts/copy-ocr-assets.mjs),
 * load only the first time someone taps the camera, and are then cached by the
 * service worker for offline use.
 */
import type { Worker } from 'tesseract.js';

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

let workerPromise: Promise<Worker> | null = null;
let progressHandler: ((p: number) => void) | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

async function getWorker(): Promise<Worker> {
  workerPromise ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    const worker = createWorker('eng', 1, {
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract/core',
      langPath: '/tesseract/lang',
      gzip: true,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') progressHandler?.(m.progress);
      },
    });
    return withTimeout(worker, 45_000, 'The receipt reader took too long to start.');
  })().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

function scheduleTerminate() {
  if (idleTimer) clearTimeout(idleTimer);
  // Free the ~100 MB worker after a minute of no use.
  idleTimer = setTimeout(async () => {
    const p = workerPromise;
    workerPromise = null;
    (await p?.catch(() => null))?.terminate();
  }, 60_000);
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      /* fall through for formats like HEIC on some browsers */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawScaled(src: ImageBitmap | HTMLImageElement, maxSide: number, grayscale: boolean): HTMLCanvasElement {
  const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const h = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;
  if (grayscale) ctx.filter = 'grayscale(1) contrast(1.25)';
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function readReceipt(file: File, onProgress?: (p: number) => void): Promise<{ text: string; thumb: string }> {
  if (!file.type.startsWith('image/')) throw new Error('That file isn\'t an image.');
  const bitmap = await loadBitmap(file);
  const thumb = drawScaled(bitmap, 220, false).toDataURL('image/jpeg', 0.7);
  const forOcr = drawScaled(bitmap, 1800, true);
  if ('close' in bitmap) bitmap.close();

  progressHandler = onProgress ?? null;
  try {
    const worker = await getWorker();
    const { data } = await withTimeout(worker.recognize(forOcr), 60_000, 'Reading the receipt took too long.');
    return { text: data.text ?? '', thumb };
  } finally {
    progressHandler = null;
    scheduleTerminate();
  }
}
