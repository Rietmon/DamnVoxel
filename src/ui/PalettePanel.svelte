<script lang="ts">
  import type { Editor } from '../app/editor';
  import { toHex } from '../core/color';
  import Popover from './Popover.svelte';
  import {
    colorCounts,
    movedOrder,
    namedEntry,
    PaletteEntriesCommand,
    PaletteNotesCommand,
    PaletteOrderCommand,
  } from '../core/palette-edit';

  interface Props {
    editor: Editor;
    /** The current colour was pressed: open the colour editor there. */
    onEditColor?: (anchor: HTMLElement) => void;
  }
  const { editor, onEditColor }: Props = $props();
  const version = $derived(editor.paletteVersion);
  const selection = $derived(editor.paletteSelection);
  const settings = $derived(editor.tools.settingsStore);

  const COLUMNS = 16;
  let grid = $state<HTMLElement>();
  /** Index in the display order the dragged colours would land before. */
  let dropAt = $state<number | null>(null);
  /** Shift-click selects from here. */
  let anchor: number | null = null;

  const order = $derived.by(() => {
    void $version;
    return [...editor.doc.palette.displayOrder()];
  });
  const css = (id: number) => {
    void $version;
    return toHex(editor.doc.palette.color(id));
  };
  const selected = $derived(new Set($selection));
  const history = $derived(editor.historyVersion);

  let libraryButton = $state<HTMLElement>();
  let libraryOpen = $state(false);
  /** Grid or list; and whether unused colours fade. Kept for the session. */
  let list = $state(false);
  let showUsed = $state(false);
  /** Voxels per colour: counted a moment after the model settles, only when shown. */
  let counts = $state.raw<Uint32Array | null>(null);
  $effect(() => {
    void $history;
    void $version;
    if (!list && !showUsed) return;
    const timer = setTimeout(() => (counts = colorCounts(editor.doc.scene)), 200);
    return () => clearTimeout(timer);
  });
  const fmt = (n: number) => n.toLocaleString('en-US');

  function rename(id: number, name: string): void {
    const palette = editor.doc.palette;
    const entry = palette.entry(id);
    if (entry.name === name) return;
    editor.doc.history.execute(
      new PaletteEntriesCommand('Color name', palette, [id], [namedEntry(entry, name)]),
    );
  }

  /** Rows of eight in panel order, as MagicaVoxel's palette notes count them. */
  const ROW = 8;
  const noteOf = (row: number) => {
    void $version;
    return editor.doc.palette.notes[row] ?? '';
  };
  function setNote(row: number, text: string): void {
    const palette = editor.doc.palette;
    if ((palette.notes[row] ?? '') === text) return;
    const notes = [...palette.notes];
    while (notes.length <= row) notes.push('');
    notes[row] = text;
    editor.doc.history.execute(new PaletteNotesCommand(palette, notes));
  }

  function select(e: PointerEvent, id: number): void {
    const current = editor.paletteSelection.get();
    if (e.ctrlKey || e.metaKey) {
      const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
      editor.selectColors(next, id);
      anchor = id;
    } else if (e.shiftKey && anchor !== null) {
      const a = order.indexOf(anchor);
      const b = order.indexOf(id);
      editor.selectColors(order.slice(Math.min(a, b), Math.max(a, b) + 1), id);
    } else {
      editor.selectColors([id], id);
      anchor = id;
    }
  }

  let drag: { id: number; ids: number[]; x: number; y: number; moved: boolean } | null = null;

  function onDown(e: PointerEvent, id: number): void {
    if (e.button !== 0) return;
    const current = editor.paletteSelection.get();
    drag = {
      id,
      ids: current.includes(id) ? current : [id],
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
  }

  function onMove(e: PointerEvent): void {
    if (!drag || !grid) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      grid.setPointerCapture(e.pointerId);
    }
    const rect = grid.getBoundingClientRect();
    const cell = rect.width / COLUMNS;
    const col = Math.max(0, Math.min(COLUMNS - 1, Math.floor((e.clientX - rect.left) / cell)));
    const row = Math.max(0, Math.floor((e.clientY - rect.top) / cell));
    const index = row * COLUMNS + col;
    // The right half of a cell means after it.
    const after = (e.clientX - rect.left) / cell - col > 0.5;
    dropAt = Math.min(order.length, index + (after ? 1 : 0));
  }

  function onUp(e: PointerEvent): void {
    const d = drag;
    drag = null;
    if (!d) return;
    if (!d.moved) select(e, d.id);
    else if (dropAt !== null) {
      const palette = editor.doc.palette;
      const next = movedOrder(order, d.ids, order[dropAt] ?? null);
      if (next.some((id, i) => id !== order[i])) {
        editor.doc.history.execute(new PaletteOrderCommand('Color order', palette, next));
      }
    }
    dropAt = null;
  }

  function onCancel(): void {
    drag = null;
    dropAt = null;
  }

  const tip = (id: number) => {
    void $version;
    const name = editor.doc.palette.entry(id).name;
    return `${id}: ${toHex(editor.doc.palette.color(id))}${name ? ` — ${name}` : ''}`;
  };
</script>

<section class="palette" aria-label="Palette">
  <header>
      <button
        type="button"
        class="edit"
        data-tip="Edit color"
        aria-label="Edit color"
        onclick={(e) => onEditColor?.(e.currentTarget)}
      >
        <span class="current" style:background={css($settings.color)}></span>
        <span class="info">{$settings.color} · {css($settings.color)}</span>
      </button>
      <button
        type="button"
        class:on={libraryOpen}
        data-tip="Palettes: built-in, your own, import and export"
        aria-label="Palette library"
        bind:this={libraryButton}
        onclick={() => (libraryOpen = !libraryOpen)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4 H8 V16 H3 Z M8 4 H13 V16 H8 Z M14 5 L17 6 L14 16 Z" /></svg>
      </button>
      <button
        type="button"
        class:on={showUsed}
        aria-pressed={showUsed}
        data-tip="Highlight the used ones: the rest fade, each shows its voxel count"
        aria-label="Highlight used"
        onclick={() => (showUsed = !showUsed)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10 C6 5 14 5 17 10 C14 15 6 15 3 10 Z M10 8 a2 2 0 1 0 .01 0" /></svg>
      </button>
      <button
        type="button"
        class:on={list}
        aria-pressed={list}
        data-tip={list ? 'As a grid' : 'As a list: names, row notes, counters'}
        aria-label="Palette view"
        onclick={() => (list = !list)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          {#if list}<path d="M3 3 H8 V8 H3 Z M12 3 H17 V8 H12 Z M3 12 H8 V17 H3 Z M12 12 H17 V17 H12 Z" />{:else}<path d="M3 5 H17 M3 10 H17 M3 15 H17" />{/if}
        </svg>
      </button>
      <button
        type="button"
        data-tip="Duplicate colors into free cells"
        aria-label="Duplicate colors"
        onclick={() => editor.actions.run('palette.duplicate')}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 7 H16 V16 H7 Z M4 13 V4 H13" /></svg>
      </button>
      <button
        type="button"
        data-tip="Gradient between the end selected colors"
        aria-label="Gradient"
        disabled={$selection.length < 3}
        onclick={() => editor.actions.run('palette.gradient')}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3 6 H17 V14 H3 Z M7 6 V14 M11 6 V14 M14 6 V14" />
        </svg>
      </button>
  </header>
    {#if list}
      <div class="list" role="listbox" aria-label="Colors" aria-multiselectable="true">
        {#each order as id, i (id)}
          {#if i % ROW === 0}
            <input
              class="note"
              placeholder="Row {i / ROW + 1}: note"
              aria-label="Note for row {i / ROW + 1}"
              value={noteOf(i / ROW)}
              onchange={(e) => setNote(i / ROW, e.currentTarget.value.trim())}
            />
          {/if}
          {@const used = counts?.[id] ?? 0}
          <div
            class="item"
            class:selected={selected.has(id)}
            class:current={$settings.color === id}
            class:unused={showUsed && counts !== null && used === 0}
            role="option"
            aria-selected={selected.has(id)}
            tabindex="-1"
            onpointerdown={(e) => select(e, id)}
          >
            <span class="swatch" style:background={css(id)}></span>
            <span class="id">{id}</span>
            <input
              class="name"
              placeholder="unnamed"
              aria-label="Name of color {id}"
              value={editor.doc.palette.entry(id).name}
              onpointerdown={(e) => e.stopPropagation()}
              onchange={(e) => rename(id, e.currentTarget.value.trim())}
            />
            <span class="count">{counts ? fmt(used) : ''}</span>
          </div>
        {/each}
      </div>
    {:else}
    <div
      class="grid"
      role="listbox"
      tabindex="-1"
      aria-multiselectable="true"
      aria-label="Colors"
      bind:this={grid}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onCancel}
    >
      {#each order as id, i (id)}
        <button
          type="button"
          class="cell"
          class:selected={selected.has(id)}
          class:current={$settings.color === id}
          class:drop-before={dropAt === i}
          class:drop-after={dropAt === order.length && i === order.length - 1}
          class:unused={showUsed && counts !== null && (counts[id] ?? 0) === 0}
          class:ramp-start={i % 16 === 8}
          style:background={css(id)}
          role="option"
          aria-selected={selected.has(id)}
          aria-label={tip(id)}
          data-tip={showUsed && counts ? `${tip(id)} · ${fmt(counts[id] ?? 0)} voxels` : tip(id)}
          onpointerdown={(e) => onDown(e, id)}
        ></button>
      {/each}
    </div>
    {/if}
</section>
{#if libraryOpen && libraryButton}
  <Popover anchor={libraryButton} label="Palette library" onClose={() => (libraryOpen = false)}>
    {#await import('./PaletteLibraryMenu.svelte') then { default: PaletteLibraryMenu }}<PaletteLibraryMenu {editor} />{/await}
  </Popover>
{/if}

<style>
  .palette {
    display: flex;
    flex-direction: column;
    user-select: none;
    -webkit-user-select: none;
  }
  header {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 6px;
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 28px;
    padding: 0 4px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text-dim);
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--panel-raised);
    color: var(--text);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .current {
    flex: none;
    width: 22px;
    height: 22px;
    margin-left: 2px;
    border: 2px solid var(--text);
    border-radius: 4px;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 60%);
  }
  .edit {
    gap: 8px;
    margin-right: auto;
    padding: 0 6px 0 2px;
  }
  .info {
    padding: 0 6px;
    color: var(--text-dim);
    font: 12px var(--mono);
  }
  svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linejoin: round;
  }
  /* Sixteen columns share the panel width: cells grow on a phone. */
  .grid {
    display: grid;
    grid-template-columns: repeat(16, 1fr);
    gap: 1px;
    padding: 4px 6px 8px;
    touch-action: none;
  }
  .cell {
    position: relative;
    min-width: 0;
    width: auto;
    height: auto;
    aspect-ratio: 1;
    padding: 0;
    border-radius: 2px;
  }
  .cell:hover {
    z-index: 1;
    box-shadow: 0 0 0 1px var(--text);
  }
  .cell.selected {
    z-index: 1;
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 80%),
      0 0 0 2px var(--accent);
  }
  .cell.current {
    z-index: 2;
    box-shadow:
      inset 0 0 0 1px rgb(0 0 0 / 80%),
      0 0 0 2px var(--text),
      0 0 0 3px rgb(0 0 0 / 70%);
  }
  /* Rows of the grid hold two ramps of eight: a gap shows where one ends. */
  .cell.ramp-start {
    margin-left: 3px;
  }
  .cell.unused,
  .item.unused {
    opacity: 0.22;
  }
  button.on {
    color: var(--accent);
  }
  .list {
    display: flex;
    flex-direction: column;
    max-height: 420px;
    padding: 0 6px 8px;
    overflow-y: auto;
  }
  .note {
    margin: 6px 0 2px;
    padding: 2px 4px;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: none;
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 600;
  }
  .note:focus {
    border-color: var(--accent);
    outline: none;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 26px;
    padding: 0 4px;
    border-radius: 4px;
    cursor: pointer;
  }
  .item:hover {
    background: var(--hover);
  }
  .item.selected {
    background: var(--accent-soft);
  }
  .item.current .swatch {
    box-shadow:
      0 0 0 2px var(--text),
      0 0 0 3px rgb(0 0 0 / 70%);
  }
  .swatch {
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 3px;
  }
  .id {
    width: 3ch;
    color: var(--text-faint);
    font: 11px var(--mono);
    text-align: right;
  }
  .name {
    flex: 1;
    min-width: 0;
    height: 22px;
    padding: 0 4px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    color: var(--text);
    font-size: 12px;
  }
  .name:focus {
    border-color: var(--accent);
    background: var(--bg);
    outline: none;
  }
  .count {
    min-width: 6ch;
    color: var(--text-dim);
    font: 11px var(--mono);
    text-align: right;
  }
  .cell.drop-before::before,
  .cell.drop-after::after {
    content: '';
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  .cell.drop-before::before {
    left: -2px;
  }
  .cell.drop-after::after {
    right: -2px;
  }
  @media (pointer: coarse) {
    button {
      min-width: 36px;
      height: 36px;
    }
  }
</style>
