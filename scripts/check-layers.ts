/**
 * Enforces the dependency direction between source layers (docs/architecture.md, "Layers and folders").
 * Run: node scripts/check-layers.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

type Layer =
  | 'formats'
  | 'kernels'
  | 'core'
  | 'io'
  | 'workers'
  | 'render'
  | 'input'
  | 'app'
  | 'ui'
  | 'entry';

/** Which layers each layer may import (besides itself). */
const ALLOWED_LAYERS: Record<Layer, readonly Layer[]> = {
  // File formats on their own, under MIT (src/formats/LICENSE): nothing of the editor.
  formats: [],
  kernels: [],
  core: ['kernels'],
  io: ['core', 'kernels', 'formats'],
  workers: ['kernels'],
  render: ['core', 'kernels'],
  input: ['core'],
  app: ['core', 'kernels', 'formats', 'io', 'workers', 'render', 'input'],
  ui: ['app', 'core'],
  entry: ['kernels', 'core', 'formats', 'io', 'workers', 'render', 'input', 'app', 'ui'],
};

/** Which npm packages each layer may import. Tests may also use `vitest` and `node:*`. */
const ALLOWED_PACKAGES: Record<Layer, readonly string[]> = {
  formats: [],
  kernels: [],
  core: [],
  io: [],
  workers: [],
  render: [],
  input: [],
  app: [],
  ui: ['svelte'],
  entry: ['svelte'],
};

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
const LAYERS = new Set<string>(Object.keys(ALLOWED_LAYERS));

const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;

function layerOf(file: string): Layer | null {
  const rel = relative(SRC, file);
  if (rel.startsWith('..')) return null;
  const parts = rel.split(sep);
  if (parts.length === 1) return 'entry';
  return LAYERS.has(parts[0]!) ? (parts[0] as Layer) : null;
}

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|svelte)$/.test(name)) out.push(path);
  }
  return out;
}

function packageName(spec: string): string {
  if (spec.startsWith('node:') || spec.startsWith('virtual:')) return spec;
  const parts = spec.split('/');
  return spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]!;
}

const errors: string[] = [];
for (const file of walk(SRC, [])) {
  const from = layerOf(file);
  const shown = relative(ROOT, file).split(sep).join('/');
  if (!from) {
    errors.push(`${shown}: file is outside of known layers`);
    continue;
  }
  const isTest = file.endsWith('.test.ts');
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = (m[1] ?? m[2] ?? m[3])!.replace(/\?.*$/, '');
    if (spec.startsWith('.')) {
      const to = layerOf(resolve(dirname(file), spec));
      if (!to) errors.push(`${shown}: imports '${spec}' outside of src layers`);
      else if (to !== from && !ALLOWED_LAYERS[from].includes(to)) {
        errors.push(`${shown}: layer '${from}' must not import '${to}' ('${spec}')`);
      }
    } else {
      const pkg = packageName(spec);
      const testOk = isTest && (pkg === 'vitest' || pkg.startsWith('node:'));
      if (!testOk && !ALLOWED_PACKAGES[from].includes(pkg)) {
        errors.push(`${shown}: layer '${from}' must not import package '${pkg}'`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`Layer check failed:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log('Layer check passed.');
