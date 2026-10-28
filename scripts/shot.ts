/**
 * Takes a screenshot of the running dev server in headless Edge or Chrome (no browser download:
 * uses the installed one). For checking the viewport by eye and, later, snapshot tests.
 *
 * node scripts/shot.ts <url> <out.png> [width] [height] [--script=<js>] [--steps=<json input>]
 *   [--wait=<ms after them>] [--mobile]
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [url, out, w = '1280', h = '800', ...rest] = process.argv.slice(2);
if (!url || !out) {
  console.error('Usage: node scripts/shot.ts <url> <out.png> [width] [height] [--script=js]');
  process.exit(2);
}
// --script=@file reads the script from a file.
const scriptArg = rest.find((a) => a.startsWith('--script='))?.slice('--script='.length);
const script = scriptArg?.startsWith('@') ? readFileSync(scriptArg.slice(1), 'utf8') : scriptArg;
const mobile = rest.includes('--mobile');
// Input to play before the shot: [["mouse.move", 10, 20], ["keyboard.down", "Space"], ...].
const steps = JSON.parse(
  rest.find((a) => a.startsWith('--steps='))?.slice('--steps='.length) ?? '[]',
) as [string, ...unknown[]][];
const wait = Number(rest.find((a) => a.startsWith('--wait='))?.slice('--wait='.length) ?? 500);

const browser = await chromium
  .launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  .catch(() => chromium.launch({ channel: 'chrome' }));
try {
  const page = await browser.newPage({
    viewport: { width: Number(w), height: Number(h) },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  // Let workers finish meshing and the frame loop settle.
  await page.waitForTimeout(1500);
  if (script) await page.evaluate(script);
  for (const [name, ...args] of steps) {
    const [object, method] = name.split('.') as ['mouse' | 'keyboard' | 'touchscreen', string];
    const target = page[object] as unknown as Record<string, (...a: unknown[]) => Promise<void>>;
    await target[method]!.apply(target, args);
  }
  if (script || steps.length > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: out });
  console.log('title:', await page.title());
  if (errors.length > 0) console.log(errors.join('\n'));
  console.log(`Saved ${out}`);
} finally {
  await browser.close();
}
