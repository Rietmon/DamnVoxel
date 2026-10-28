<script lang="ts">
  import type { Editor } from '../app/editor';
  import { NODE_TEMPLATES } from '../app/node-templates';
  import { highlightProgram } from '../app/program-highlight';
  import { PROGRAM_TEMPLATES } from '../app/program-templates';
  import { programSpecs } from '../app/programs';
  import { compileGraph, type NodeGraph } from '../core/node-graph';
  import type { VoxelObject } from '../core/scene';
  import Icon from './Icon.svelte';
  import NodeEditor from './NodeEditor.svelte';
  import NumberField from './NumberField.svelte';

  /**
   * The program window (docs/programs.md, “Code editor”): code with colours and line numbers,
   * the parameters it declares as fields, and how its last run went. Each pause in typing builds
   * the object again; Ctrl+Enter builds at once.
   */
  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const open = $derived(editor.programOpen);
  const status = $derived(editor.programStatus);
  const historyVersion = $derived(editor.historyVersion);
  const sceneVersion = $derived(editor.sceneVersion);

  let source = $state('');
  /** What was last handed to the editor: a different program in the object came from undo. */
  let sent = '';
  let shownFor: VoxelObject | null = null;
  let timer = 0;
  let area = $state<HTMLTextAreaElement>();
  let pre = $state<HTMLPreElement>();
  let gutter = $state<HTMLDivElement>();
  let showApi = $state(false);
  /** The node graph of a node program, and what keeps it from building. */
  let graph = $state.raw<NodeGraph | null>(null);
  let sentGraph: unknown = null;
  let graphErrors = $state<string[]>([]);
  let tab = $state<'nodes' | 'code'>('nodes');

  const object = $derived($open && $open !== 'new' ? $open : null);
  const html = $derived(highlightProgram(source));
  const lineCount = $derived(source.split('\n').length);

  // Follow the object: its program when opened, and undo or redo changing it.
  $effect(() => {
    void $historyVersion;
    void $sceneVersion;
    const o = object;
    if (!o) return;
    const spec = programSpecs.get(o);
    if (!spec || !editor.doc.scene.objects().includes(o)) {
      editor.programOpen.set(null);
      return;
    }
    if (o !== shownFor || spec.source !== sent) {
      source = spec.source;
      sent = spec.source;
    }
    if (o !== shownFor || spec.graph !== sentGraph) {
      graph = (spec.graph as NodeGraph | null) ?? null;
      sentGraph = spec.graph;
      graphErrors = [];
    }
    shownFor = o;
  });

  /** A graph edit: wires and values build the object again; moving cards only keeps the layout. */
  function graphChanged(next: NodeGraph, layoutOnly: boolean) {
    if (!object) return;
    graph = next;
    sentGraph = next;
    if (layoutOnly) {
      editor.setProgramGraph(object, next);
      return;
    }
    const compiled = compileGraph(next);
    graphErrors = compiled.errors;
    if (compiled.errors.length > 0) {
      editor.setProgramGraph(object, next);
      return;
    }
    sent = compiled.source;
    source = compiled.source;
    void editor.updateProgram(object, { graph: next, source: compiled.source });
  }

  /** A node program becomes code to edit by hand; the nodes are let go. */
  function detach() {
    if (!object) return;
    sentGraph = null;
    graph = null;
    void editor.updateProgram(object, { graph: null });
  }

  function newFromNodes(t: (typeof NODE_TEMPLATES)[number]) {
    const g = t.graph();
    void editor.newProgram(compileGraph(g).source, t.title, g);
  }

  function send() {
    clearTimeout(timer);
    if (!object || source === sent) return;
    sent = source;
    void editor.updateProgram(object, { source });
  }

  function edit(next: string) {
    source = next;
    clearTimeout(timer);
    timer = window.setTimeout(send, 400);
  }

  function setParam(name: string, value: number) {
    const spec = object ? programSpecs.get(object) : undefined;
    if (!object || !spec) return;
    void editor.updateProgram(object, { params: { ...spec.params, [name]: value } });
  }

  function key(e: KeyboardEvent) {
    const t = e.currentTarget as HTMLTextAreaElement;
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      t.setRangeText('  ', t.selectionStart, t.selectionEnd, 'end');
      edit(t.value);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    } else if (e.key === 'Enter') {
      // Keep the indent of the line.
      e.preventDefault();
      const before = t.value.slice(0, t.selectionStart);
      const indent = /[^\n]*$/.exec(before)![0].match(/^\s*/)![0];
      const extra = /[{([]\s*$/.test(before) ? '  ' : '';
      t.setRangeText(`\n${indent}${extra}`, t.selectionStart, t.selectionEnd, 'end');
      edit(t.value);
    }
  }

  function scroll() {
    if (!area || !pre || !gutter) return;
    pre.scrollTop = area.scrollTop;
    pre.scrollLeft = area.scrollLeft;
    gutter.scrollTop = area.scrollTop;
  }

  function close() {
    send();
    editor.programOpen.set(null);
  }

  const describe = (src: string) => /^\/\/\s*(.*)$/m.exec(src)?.[1] ?? '';
  const decimals = (step: number) => (step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step))));

  const API_LINES = [
    'param(name, value, min, max, step)',
    "color('#rrggbb') · color(r, g, b) · palette(n)",
    'set(x, y, z, c) · get(x, y, z) · erase(x, y, z)',
    'box(x0, y0, z0, x1, y1, z1, c)',
    'sphere(x, y, z, r, c) · ellipsoid(x, y, z, rx, ry, rz, c)',
    'cylinder(x, y, z, r, h, c) · cone(x, y, z, r, h, c)',
    'torus(x, y, z, R, r, c) · line(x0, y0, z0, x1, y1, z1, c, radius)',
    'fill(x0, y0, z0, x1, y1, z1, (x, y, z) => c)',
    'shape((x, y, z) => d, c, x0, y0, z0, x1, y1, z1)',
    'sd.sphere / box / cylinder / torus / capsule',
    'sd.union / subtract / intersect / smoothUnion(a, b, k)',
    'noise(x, y, z) · fbm(x, y, z, octaves) · rand() · seed(n)',
    'lerp · clamp · smoothstep · ramp(t, [colors]) · log(...)',
  ];
</script>

<section class="panel" class:wide={graph !== null && tab === 'nodes'} aria-label="Program">
  <header>
    <Icon name="command" />
    <span class="title">{object ? `Program · ${object.name}` : 'New program'}</span>
    {#if object && graph}
      <span class="seg" role="tablist" aria-label="Program view">
        <button type="button" role="tab" aria-selected={tab === 'nodes'} class:on={tab === 'nodes'} onclick={() => (tab = 'nodes')}>Nodes</button>
        <button type="button" role="tab" aria-selected={tab === 'code'} class:on={tab === 'code'} onclick={() => (tab = 'code')}>Code</button>
      </span>
    {:else if object}
      <button type="button" class="btn" class:on={showApi} aria-pressed={showApi} onclick={() => (showApi = !showApi)}>API</button>
      <button type="button" class="btn" data-tip="Build now · Ctrl+Enter" onclick={send}>▶</button>
    {/if}
    <button type="button" class="btn icon" aria-label="Close" onclick={close}><Icon name="close" /></button>
  </header>

  {#if !object}
    <div class="start">
      <p class="hint">The shape becomes an object in the center of the view; the code, nodes and parameters can be changed as much as you like.</p>
      <h3>With nodes</h3>
      <div class="templates">
        {#each NODE_TEMPLATES as t (t.id)}
          <button type="button" class="tpl" onclick={() => newFromNodes(t)}>
            <span class="name">{t.title}</span>
            <span class="desc">{t.description}</span>
          </button>
        {/each}
      </div>
      <h3>With code</h3>
      <div class="templates">
        {#each PROGRAM_TEMPLATES as t (t.id)}
          <button type="button" class="tpl" onclick={() => void editor.newProgram(t.source, t.title)}>
            <span class="name">{t.title}</span>
            <span class="desc">{describe(t.source)}</span>
          </button>
        {/each}
      </div>
    </div>
  {:else if graph && tab === 'nodes'}
    <NodeEditor {graph} onChange={graphChanged} />
    {#if $status.params.length > 0}
      <div class="params">
        {#each $status.params as p (p.name)}
          <label class="row">
            <span>{p.name}</span>
            <span class="num">
              <NumberField label={p.name} value={p.value} min={p.min} max={p.max} step={p.step} decimals={decimals(p.step)} onChange={(v) => setParam(p.name, v)} />
            </span>
          </label>
        {/each}
      </div>
    {/if}
    <footer class:bad={graphErrors.length > 0 || $status.error !== null}>
      {#if graphErrors.length > 0}
        {graphErrors.join(' · ')}
      {:else if $status.running}
        Working…
      {:else if $status.error}
        {$status.error.message}
      {:else}
        {$status.voxels.toLocaleString('en-US')} voxels · {$status.ms} ms · right button or “+ Node” to add
      {/if}
    </footer>
  {:else if graph}
    <p class="hint">This program is built from nodes. To edit it by hand, unlink it from the nodes — from then on it is code.</p>
    <pre class="compiled">{@html html}</pre>
    <footer><button type="button" class="btn" onclick={detach}>Edit as code (without nodes)</button></footer>
  {:else}
    {#if showApi}
      <ul class="api">
        {#each API_LINES as l (l)}<li>{l}</li>{/each}
      </ul>
    {/if}
    <div class="code">
      <div class="gutter" bind:this={gutter} aria-hidden="true">
        {#each { length: lineCount } as _, i (i)}
          <span class:err={$status.error?.line === i + 1}>{i + 1}</span>
        {/each}
      </div>
      <div class="area">
        <!-- Colours under the text: the textarea's own text is transparent. -->
        <pre bind:this={pre} aria-hidden="true">{@html html}</pre>
        <textarea
          bind:this={area}
          value={source}
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          aria-label="Program code"
          oninput={(e) => edit(e.currentTarget.value)}
          onkeydown={key}
          onscroll={scroll}
          onblur={send}
        ></textarea>
      </div>
    </div>
    {#if $status.params.length > 0}
      <div class="params">
        {#each $status.params as p (p.name)}
          <label class="row">
            <span>{p.name}</span>
            <span class="num">
              <NumberField label={p.name} value={p.value} min={p.min} max={p.max} step={p.step} decimals={decimals(p.step)} onChange={(v) => setParam(p.name, v)} />
            </span>
          </label>
        {/each}
      </div>
    {/if}
    <footer class:bad={$status.error !== null}>
      {#if $status.running}
        Working…
      {:else if $status.error}
        {$status.error.line ? `Line ${$status.error.line}: ` : ''}{$status.error.message}
      {:else}
        {$status.voxels.toLocaleString('en-US')} voxels · {$status.ms} ms
      {/if}
    </footer>
    {#if $status.log.length > 0}
      <pre class="log">{$status.log.join('\n')}</pre>
    {/if}
  {/if}
</section>

<style>
  .panel {
    position: absolute;
    top: 12px;
    left: 12px;
    bottom: 12px;
    z-index: 5;
    display: flex;
    flex-direction: column;
    width: min(500px, calc(100% - 24px));
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    box-shadow: var(--shadow-float);
    overflow: hidden;
  }
  header {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    padding: 4px 4px 4px 10px;
    border-bottom: 1px solid var(--line);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Nodes want width, the model wants to stay in sight: a strip along the bottom. */
  .panel.wide {
    top: auto;
    right: 12px;
    width: auto;
    height: min(48%, 460px);
  }
  .hint {
    margin: 0;
    padding: 10px 12px 4px;
    color: var(--text-faint);
    font-size: 12px;
  }
  .start {
    overflow-y: auto;
  }
  h3 {
    margin: 8px 12px 0;
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 500;
  }
  .compiled {
    position: static;
    flex: 1;
    margin: 0;
    padding: 8px 12px;
    overflow: auto;
    font: 12px/18px var(--mono);
    white-space: pre;
    pointer-events: auto;
  }
  .templates {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
    padding: 8px 12px 12px;
    overflow-y: auto;
  }
  .tpl {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .tpl:hover {
    border-color: var(--accent);
  }
  .name {
    font-weight: 600;
  }
  .desc {
    color: var(--text-faint);
    font-size: 12px;
  }
  .api {
    flex: none;
    margin: 0;
    padding: 6px 12px 6px 28px;
    border-bottom: 1px solid var(--line);
    color: var(--text-dim);
    font: 12px/1.6 var(--mono);
  }
  .code {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 120px;
    font: 13px/20px var(--mono);
    tab-size: 2;
  }
  .gutter {
    display: flex;
    flex: none;
    flex-direction: column;
    width: 40px;
    padding: 8px 6px 8px 0;
    overflow: hidden;
    color: var(--text-faint);
    text-align: right;
    user-select: none;
  }
  .gutter .err {
    color: var(--danger);
    font-weight: 700;
  }
  .area {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  pre,
  textarea {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    margin: 0;
    padding: 8px;
    border: 0;
    font: inherit;
    white-space: pre;
    overflow-wrap: normal;
  }
  pre {
    overflow: hidden;
    color: var(--text);
    pointer-events: none;
  }
  textarea {
    resize: none;
    overflow: auto;
    background: transparent;
    color: transparent;
    caret-color: var(--text);
    outline: none;
  }
  textarea::selection {
    background: var(--accent-soft);
  }
  pre :global(.k) {
    color: #a970ff;
  }
  pre :global(.f) {
    color: #4d8eff;
  }
  pre :global(.s) {
    color: #3fa34d;
  }
  pre :global(.n) {
    color: #e07b39;
  }
  pre :global(.c) {
    color: var(--text-faint);
    font-style: italic;
  }
  .params {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 2px;
    max-height: 30%;
    padding: 6px 12px;
    border-top: 1px solid var(--line);
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--text-dim);
  }
  .num {
    width: 88px;
  }
  footer {
    flex: none;
    padding: 6px 12px;
    border-top: 1px solid var(--line);
    color: var(--text-dim);
    font-size: 12px;
  }
  footer.bad {
    color: var(--danger);
  }
  .log {
    position: static;
    flex: none;
    max-height: 80px;
    padding: 4px 12px 8px;
    overflow: auto;
    color: var(--text-dim);
    font: 12px/1.5 var(--mono);
    pointer-events: auto;
  }
</style>
