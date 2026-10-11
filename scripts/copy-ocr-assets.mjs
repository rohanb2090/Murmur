// Copies the Tesseract worker, wasm core and English model into public/ so OCR
// is served from our own origin (works offline, no third-party CDN at runtime).
import { cpSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'tesseract');
mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });

cpSync(join(nm, 'tesseract.js/dist/worker.min.js'), join(out, 'worker.min.js'));
for (const f of readdirSync(join(nm, 'tesseract.js-core'))) {
  if (/lstm\.wasm(\.js)?$/.test(f)) cpSync(join(nm, 'tesseract.js-core', f), join(out, 'core', f));
}
const lang = join(nm, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
if (!existsSync(lang)) throw new Error('Missing @tesseract.js-data/eng — run npm install');
cpSync(lang, join(out, 'lang', 'eng.traineddata.gz'));
console.log('[murmur] OCR assets copied to public/tesseract');
