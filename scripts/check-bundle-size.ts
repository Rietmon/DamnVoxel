/**
 * Measures what the browser downloads on first launch (gzip) and compares it with the budget.
 * The budget is read from docs/stack.md, the only place where budget numbers live.
 *
 * First launch = files referenced by dist/index.html plus everything they import statically
 * or start as workers. Code behind dynamic `import()` is loaded on demand and is not counted.
 * Run after `pnpm build`: node scripts/check-bundle-size.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');

function readBudgetKB(): number {
  const stack = readFileSync(join(ROOT, 'docs', 'stack.md'), 'utf8');
  const match = stack.match(/JS \+ CSS on first launch \| ≤ (\d+) KB gzip/);
  if (!match) throw new Error('Budget row "JS + CSS on first launch" not found in docs/stack.md');
  return Number(match[1]);
}

const HTML_REF_RE = /<(?:script|link)\b[^>]*?(?:src|href)="([^"]+\.(?:js|css))"/g;
const STATIC_IMPORT_RE =
  /(?:^|[;}\s])(?:import|export)\s*(?:[\w$*{},\s]*from\s*)?["']([^"']+\.js)["']/g;
// Vite writes worker URLs with any kind of quotes, backticks included.
const WORKER_URL_RE = /new URL\(\s*["'`]([^"'`]+\.js)["'`]\s*,\s*import\.meta\.url\s*\)/g;

function collect(): Set<string> {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const files = new Set<string>();
  const queue: string[] = [];
  const add = (path: string) => {
    if (files.has(path)) return;
    if (!existsSync(path)) throw new Error(`Referenced file is missing: ${relative(ROOT, path)}`);
    files.add(path);
    if (path.endsWith('.js')) queue.push(path);
  };
  for (const m of html.matchAll(HTML_REF_RE)) add(join(DIST, m[1]!.replace(/^\.?\//, '')));
  while (queue.length > 0) {
    const file = queue.pop()!;
    const code = readFileSync(file, 'utf8');
    const refs = [...code.matchAll(STATIC_IMPORT_RE), ...code.matchAll(WORKER_URL_RE)];
    for (const m of refs) {
      const spec = m[1]!;
      // Absolute paths start at the build root; everything else is relative to the module
      // (static imports are "./x.js", worker URLs are resolved against import.meta.url).
      if (spec.startsWith('/')) add(join(DIST, spec.slice(1)));
      else add(resolve(dirname(file), spec));
    }
  }
  return files;
}

const budgetKB = readBudgetKB();
const rows = [...collect()].map((path) => {
  const bytes = readFileSync(path);
  return {
    name: relative(DIST, path).split('\\').join(posix.sep),
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
  };
});
rows.sort((a, b) => b.gzip - a.gzip);
const total = rows.reduce((s, r) => s + r.gzip, 0);
const kb = (n: number) => (n / 1000).toFixed(1);

for (const r of rows)
  console.log(`${kb(r.gzip).padStart(8)} kB gzip  ${kb(r.raw).padStart(8)} kB  ${r.name}`);
console.log(`${kb(total).padStart(8)} kB gzip total on first launch, budget ${budgetKB} kB`);
if (total > budgetKB * 1000) {
  console.error(`Bundle is over budget by ${kb(total - budgetKB * 1000)} kB.`);
  process.exit(1);
}
