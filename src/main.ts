import { mount } from 'svelte';
import { indexedDbAutosave } from './app/autosave';
import { createDemoDocument } from './app/demo';
import { Editor } from './app/editor';
import { rememberPreferences } from './app/preferences';
import { registerServiceWorker } from './app/pwa';
import { startAutosave } from './app/session';
import { writable } from './app/store';
import { VoxelDocument } from './core/document';
import { checkWebGL2 } from './render/support';
import App from './ui/App.svelte';
import NoWebGL from './ui/NoWebGL.svelte';
import './ui/theme.css';

const update = writable<(() => void) | null>(null);
registerServiceWorker((apply) => update.set(apply));

const target = document.getElementById('app');
if (!target) throw new Error('#app not found');

const params = new URLSearchParams(location.search);
// `?nowebgl` in dev shows the fallback screen without breaking the browser.
const support =
  import.meta.env.DEV && params.has('nowebgl')
    ? ({ ok: false, reason: 'failed', detail: 'forced by ?nowebgl' } as const)
    : checkWebGL2();

if (support.ok) {
  // `?bench` opens a 256³ terrain (`?bench=large`: 1024 × 1024) and measures meshing and frame
  // rate on this device; the benchmark code loads only then.
  const bench = params.has('bench') ? await import('./app/bench') : null;
  // `?demo` opens the sample island instead of an empty document.
  const doc = bench
    ? bench.createBenchDocument(
        params.get('bench') === 'large' ? bench.LARGE_BENCH_SIZE : bench.BENCH_SIZE,
      )
    : params.has('demo')
      ? createDemoDocument()
      : VoxelDocument.createEmpty();
  const editor = new Editor(doc);
  // The benchmark measures a fresh editor; everyone else gets their layout and work back.
  if (!bench) {
    rememberPreferences(editor);
    const storage = indexedDbAutosave();
    if (storage) void startAutosave(editor, storage);
  }
  // `?stats` shows frame statistics.
  if (params.has('stats') || bench) editor.showStats.set(true);
  // A handle for poking at the editor from the devtools console.
  if (import.meta.env.DEV) Object.assign(window, { editor });
  const benchResult = bench ? bench.runBench(editor) : null;
  mount(App, { target, props: { editor, update, bench: benchResult } });
} else {
  mount(NoWebGL, { target, props: { reason: support.reason, detail: support.detail } });
}
