<script lang="ts">
  import {
    canLink,
    type GraphNode,
    link,
    NODE_DEFS,
    NODE_TYPES,
    type NodeDef,
    type NodeGraph,
    type NodeGroup,
    newNode,
  } from '../core/node-graph';
  import NumberField from './NumberField.svelte';

  /**
   * The node canvas (docs/programs.md, “Node editor”): cards with their fields, wires from an
   * output dot to an input dot, a menu of nodes. Drag a header to move a card, the background to
   * pan, the wheel to zoom; drag from a dot to wire, from a wired input to rewire or let go.
   * Layout is fixed (rows of one height), so dots are where the numbers say.
   */
  interface Props {
    graph: NodeGraph;
    /** A change that alters the program (wires, values, nodes) or only where cards sit. */
    onChange: (graph: NodeGraph, layoutOnly: boolean) => void;
  }
  const { graph, onChange }: Props = $props();

  const NODE_W = 210;
  const HEAD = 30;
  const ROW = 30;

  let view = $state({ x: 16, y: 16, k: 0.85 });
  let root = $state<HTMLDivElement>();
  /** A wire being drawn: from an output, to the pointer (canvas units). */
  let drag = $state<{ from: number; x: number; y: number } | null>(null);
  let menu = $state<{ x: number; y: number; at: [number, number] } | null>(null);

  /** The rows of a card: solid inputs first, then fields; number wires land on fields. */
  function rows(def: NodeDef) {
    return [
      ...def.inputs.filter((p) => p.type === 'shape').map((p) => ({ id: p.id, title: p.title, kind: 'shape' as const })),
      ...def.fields.map((f) => ({ id: f.id, title: f.title, kind: f.kind, field: f })),
    ];
  }
  const portY = (def: NodeDef, port: string) => {
    const i = rows(def).findIndex((r) => r.id === port);
    return HEAD + Math.max(0, i) * ROW + ROW / 2;
  };
  const nodeById = (id: number) => graph.nodes.find((n) => n.id === id);
  const wiredInto = (n: GraphNode, port: string) => graph.links.find((l) => l.to === n.id && l.port === port);

  function curve(x1: number, y1: number, x2: number, y2: number): string {
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }
  const wires = $derived(
    graph.links.flatMap((l) => {
      const a = nodeById(l.from);
      const b = nodeById(l.to);
      const db = b && NODE_TYPES.get(b.type);
      if (!a || !b || !db) return [];
      const kind = NODE_TYPES.get(a.type)?.output ?? 'shape';
      return [{ key: `${l.from}-${l.to}-${l.port}`, d: curve(a.x + NODE_W, a.y + HEAD / 2, b.x, b.y + portY(db, l.port)), kind }];
    }),
  );

  /** A pointer position in canvas units. */
  function toCanvas(e: PointerEvent | MouseEvent | WheelEvent): [number, number] {
    const r = root!.getBoundingClientRect();
    return [(e.clientX - r.left - view.x) / view.k, (e.clientY - r.top - view.y) / view.k];
  }

  function change(next: NodeGraph, layoutOnly = false) {
    onChange(next, layoutOnly);
  }

  function setValue(n: GraphNode, id: string, value: number | string) {
    change({
      ...graph,
      nodes: graph.nodes.map((m) => (m.id === n.id ? { ...m, values: { ...m.values, [id]: value } } : m)),
    });
  }

  function remove(n: GraphNode) {
    change({
      nodes: graph.nodes.filter((m) => m.id !== n.id),
      links: graph.links.filter((l) => l.from !== n.id && l.to !== n.id),
    });
  }

  function add(type: string, at: [number, number]) {
    const id = Math.max(0, ...graph.nodes.map((n) => n.id)) + 1;
    change({ ...graph, nodes: [...graph.nodes, newNode(type, id, at[0], at[1])] });
    menu = null;
  }

  /** Moves a card by its header. */
  function moveCard(e: PointerEvent, n: GraphNode) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = [e.clientX, e.clientY];
    const origin = [n.x, n.y];
    let moved = graph;
    const move = (m: PointerEvent) => {
      const x = Math.round(origin[0]! + (m.clientX - start[0]!) / view.k);
      const y = Math.round(origin[1]! + (m.clientY - start[1]!) / view.k);
      moved = { ...graph, nodes: graph.nodes.map((c) => (c.id === n.id ? { ...c, x, y } : c)) };
      change(moved, true);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  /** Draws a wire from an output; drops it on an input dot. */
  function startWire(e: PointerEvent, from: number) {
    e.stopPropagation();
    e.preventDefault();
    const [x, y] = toCanvas(e);
    drag = { from, x, y };
    const move = (m: PointerEvent) => {
      const [mx, my] = toCanvas(m);
      drag = { from, x: mx, y: my };
    };
    const up = (u: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const target = document.elementFromPoint(u.clientX, u.clientY)?.closest<HTMLElement>('[data-in]');
      drag = null;
      if (!target) return;
      const to = Number(target.dataset.node);
      const port = target.dataset.in!;
      if (canLink(graph, from, to, port)) change(link(graph, from, to, port));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** A wired input: take the wire off and carry it from its source. */
  function grabInput(e: PointerEvent, n: GraphNode, port: string) {
    const l = wiredInto(n, port);
    if (!l) return;
    e.stopPropagation();
    change({ ...graph, links: graph.links.filter((x) => x !== l) });
    startWire(e, l.from);
  }

  function pan(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('.card') || e.button === 2) return;
    menu = null;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = [e.clientX - view.x, e.clientY - view.y];
    const move = (m: PointerEvent) => {
      view = { ...view, x: m.clientX - start[0]!, y: m.clientY - start[1]! };
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  function zoom(e: WheelEvent) {
    e.preventDefault();
    const r = root!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const k = Math.max(0.35, Math.min(1.6, view.k * Math.exp(-e.deltaY * 0.0015)));
    view = { x: px - ((px - view.x) / view.k) * k, y: py - ((py - view.y) / view.k) * k, k };
  }

  function openMenu(e: MouseEvent, at = toCanvas(e)) {
    e.preventDefault();
    const r = root!.getBoundingClientRect();
    menu = { x: Math.min(e.clientX - r.left, r.width - 230), y: Math.min(e.clientY - r.top, r.height - 300), at };
  }

  /** Fits every card into the canvas (no larger than life). */
  function fit() {
    if (!root || graph.nodes.length === 0) return;
    const r = root.getBoundingClientRect();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const n of graph.nodes) {
      const def = NODE_TYPES.get(n.type);
      const h = HEAD + (def ? rows(def).length : 0) * ROW;
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + NODE_W);
      y1 = Math.max(y1, n.y + h);
    }
    // Readable first: a graph wider than the canvas starts at its left and pans.
    const k = Math.max(0.6, Math.min(1, (r.width - 40) / (x1 - x0), (r.height - 56) / (y1 - y0)));
    view = { k, x: Math.max(16, (r.width - (x1 - x0) * k) / 2) - x0 * k, y: 44 - y0 * k };
  }

  // Once, when the canvas is first laid out.
  $effect(() => {
    if (root) requestAnimationFrame(fit);
  });

  const GROUPS: NodeGroup[] = ['Shapes', 'Combine', 'Transform', 'Color', 'Numbers', 'Output'];
  const hasOutput = $derived(graph.nodes.some((n) => n.type === 'output'));
</script>

<div
  class="canvas"
  bind:this={root}
  role="application"
  aria-label="Nodes"
  onpointerdown={pan}
  onwheel={zoom}
  oncontextmenu={(e) => openMenu(e)}
>
  <div class="content" style:transform="translate({view.x}px, {view.y}px) scale({view.k})">
    <svg class="wires" aria-hidden="true">
      {#each wires as w (w.key)}<path d={w.d} class={w.kind} />{/each}
      {#if drag}
        {@const a = nodeById(drag.from)}
        {#if a}<path d={curve(a.x + NODE_W, a.y + HEAD / 2, drag.x, drag.y)} class="live" />{/if}
      {/if}
    </svg>
    {#each graph.nodes as n (n.id)}
      {@const def = NODE_TYPES.get(n.type)}
      {#if def}
        <div class="card {def.group === 'Output' ? 'out' : ''}" style:left="{n.x}px" style:top="{n.y}px" style:width="{NODE_W}px">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <header onpointerdown={(e) => moveCard(e, n)}>
            <span class="t">{def.title}</span>
            {#if def.type !== 'output'}
              <button type="button" class="x" aria-label="Delete node" onclick={() => remove(n)}>×</button>
            {/if}
            {#if def.output}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="dot outp {def.output}" data-out={n.id} onpointerdown={(e) => startWire(e, n.id)}></span>
            {/if}
          </header>
          {#each rows(def) as r (r.id)}
            {@const wired = wiredInto(n, r.id)}
            <div class="row">
              {#if r.kind === 'shape' || r.kind === 'number'}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                  class="dot inp {r.kind === 'shape' ? 'shape' : 'number'}"
                  class:on={!!wired}
                  data-in={r.id}
                  data-node={n.id}
                  onpointerdown={(e) => grabInput(e, n, r.id)}
                ></span>
              {/if}
              <span class="label">{r.title}</span>
              {#if r.kind === 'shape'}
                <span class="hint">{wired ? '' : 'not connected'}</span>
              {:else if wired}
                <span class="hint">← wire</span>
              {:else if r.kind === 'number' && 'field' in r}
                <span class="num">
                  <NumberField
                    label={r.title}
                    value={Number(n.values[r.id] ?? r.field.default)}
                    min={r.field.min}
                    max={r.field.max}
                    step={r.field.step}
                    decimals={(r.field.step ?? 1) < 1 ? 2 : 0}
                    onChange={(v) => setValue(n, r.id, v)}
                  />
                </span>
              {:else if r.kind === 'color'}
                <input class="color" type="color" value={String(n.values[r.id])} onchange={(e) => setValue(n, r.id, e.currentTarget.value)} aria-label={r.title} />
              {:else if r.kind === 'axis'}
                <span class="seg">
                  {#each ['x', 'y', 'z'] as a (a)}
                    <button type="button" class:on={n.values[r.id] === a} onclick={() => setValue(n, r.id, a)}>{a.toUpperCase()}</button>
                  {/each}
                </span>
              {:else}
                <input class="text" type="text" value={String(n.values[r.id] ?? '')} onchange={(e) => setValue(n, r.id, e.currentTarget.value)} aria-label={r.title} />
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/each}
  </div>
  <div class="tools">
    <button type="button" class="btn" onclick={(e) => openMenu(e, [(-view.x + 40) / view.k, (-view.y + 60) / view.k])}>+ Node</button>
    <button type="button" class="btn" data-tip="Show all nodes" onclick={fit}>Fit</button>
  </div>
  {#if !hasOutput}<p class="warn">A “Result” node is needed — it is in the “Output” section.</p>{/if}
  {#if menu}
    <div class="menu" role="menu" style:left="{menu.x}px" style:top="{menu.y}px">
      {#each GROUPS as g (g)}
        <div class="group">{g}</div>
        {#each NODE_DEFS.filter((d) => d.group === g && !(d.type === 'output' && hasOutput)) as d (d.type)}
          <button type="button" role="menuitem" onclick={() => add(d.type, menu!.at)}>{d.title}</button>
        {/each}
      {/each}
    </div>
  {/if}
</div>

<style>
  .canvas {
    position: relative;
    flex: 1;
    min-height: 200px;
    overflow: hidden;
    background-color: var(--bg);
    background-image: radial-gradient(var(--line) 1px, transparent 1px);
    background-size: 20px 20px;
    touch-action: none;
    cursor: grab;
  }
  .content {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
  }
  .wires {
    position: absolute;
    overflow: visible;
    width: 1px;
    height: 1px;
    pointer-events: none;
  }
  .wires path {
    fill: none;
    stroke: var(--text-dim);
    stroke-width: 2.5;
  }
  .wires path.number {
    stroke: #4d8eff;
  }
  .wires path.live {
    stroke: var(--accent);
    stroke-dasharray: 6 4;
  }
  .card {
    position: absolute;
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    background: var(--surface);
    box-shadow: 0 2px 8px rgb(0 0 0 / 25%);
    cursor: default;
  }
  .card.out {
    border-color: var(--accent);
  }
  header {
    position: relative;
    display: flex;
    align-items: center;
    height: 30px;
    padding: 0 6px 0 10px;
    border-bottom: 1px solid var(--line);
    border-radius: 8px 8px 0 0;
    background: var(--surface-2);
    cursor: move;
    user-select: none;
  }
  .t {
    flex: 1;
    font-weight: 600;
    font-size: 13px;
  }
  .x {
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--text-faint);
    cursor: pointer;
  }
  .x:hover {
    background: var(--hover);
    color: var(--text);
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 8px 0 12px;
    font-size: 12px;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-dim);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    color: var(--text-faint);
    font-size: 11px;
  }
  .num {
    width: 80px;
  }
  .color {
    width: 34px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    background: none;
  }
  .text {
    width: 90px;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    background: var(--surface-2);
    font-size: 12px;
  }
  .seg > button {
    height: 22px;
    padding: 0 7px;
  }
  .dot {
    position: absolute;
    width: 12px;
    height: 12px;
    border: 2px solid var(--surface);
    border-radius: 50%;
    background: var(--text-faint);
    cursor: crosshair;
  }
  .dot.shape {
    background: var(--text-dim);
  }
  .dot.number {
    background: #4d8eff;
  }
  .dot.inp {
    left: -7px;
    top: 9px;
    opacity: 0.55;
  }
  .dot.inp.on,
  .dot.inp:hover {
    opacity: 1;
  }
  .dot.outp {
    right: -7px;
    top: 9px;
  }
  .dot:hover {
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .tools {
    position: absolute;
    top: 8px;
    left: 8px;
    display: flex;
    gap: 4px;
  }
  .tools .btn {
    background: var(--surface);
    box-shadow: var(--shadow-float);
    color: var(--text);
  }
  .warn {
    position: absolute;
    left: 8px;
    bottom: 8px;
    margin: 0;
    color: var(--danger);
    font-size: 12px;
  }
  .menu {
    position: absolute;
    z-index: 2;
    display: flex;
    flex-direction: column;
    width: 220px;
    max-height: 300px;
    padding: 4px;
    overflow-y: auto;
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    background: var(--surface);
    box-shadow: var(--shadow-float);
  }
  .group {
    padding: 6px 8px 2px;
    color: var(--text-faint);
    font-size: 11px;
  }
  .menu button {
    padding: 5px 10px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .menu button:hover {
    background: var(--hover);
  }
</style>
