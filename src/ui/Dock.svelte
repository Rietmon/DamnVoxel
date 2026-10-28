<script lang="ts" module>
  export type Section = 'palette' | 'scene' | 'layers' | 'refs' | 'assets' | 'view';
</script>

<script lang="ts">
  import type { Editor } from '../app/editor';
  import { clampSideWidth, SIDE_WIDTH } from '../app/ui-state';
  import Icon from './Icon.svelte';
  import AssetsPanel from './AssetsPanel.svelte';
  import LayersPanel from './LayersPanel.svelte';
  import PalettePanel from './PalettePanel.svelte';
  import ReferencesPanel from './ReferencesPanel.svelte';
  import SceneTree from './SceneTree.svelte';

  interface Props {
    editor: Editor;
    /** Phone: one section as a sheet over the view; null hides it. Undefined: the side dock. */
    sheet?: Section | null;
    onSheet?: (section: Section | null) => void;
    onEditColor?: (anchor: HTMLElement) => void;
  }
  const { editor, sheet = undefined, onSheet, onEditColor }: Props = $props();
  const ui = $derived(editor.ui);
  const asSheet = $derived(sheet !== undefined);

  const TITLES: Record<Section, string> = {
    palette: 'Palette',
    scene: 'Scene',
    layers: 'Layers',
    refs: 'References',
    assets: 'Library',
    view: 'View',
  };
  const DOCKED: Section[] = ['palette', 'scene', 'layers', 'refs', 'assets'];
  const folded = $derived(new Set($ui.folded));

  function toggle(s: Section): void {
    editor.ui.update((u) => ({
      ...u,
      folded: u.folded.includes(s) ? u.folded.filter((f) => f !== s) : [...u.folded, s],
    }));
  }

  /** Dragging the left edge resizes the dock; a double click puts the width back. */
  function resize(e: PointerEvent): void {
    if (e.button !== 0) return;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = editor.ui.get().sideWidth;
    const move = (ev: PointerEvent) => {
      const sideWidth = clampSideWidth(startWidth + startX - ev.clientX);
      editor.ui.update((u) => ({ ...u, sideWidth }));
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      editor.resize();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }
</script>

{#snippet body(s: Section)}
  {#if s === 'palette'}
    <PalettePanel {editor} {onEditColor} />
  {:else if s === 'scene'}
    <SceneTree {editor} />
  {:else if s === 'layers'}
    <LayersPanel {editor} />
  {:else if s === 'assets'}
    <AssetsPanel {editor} />
  {:else if s === 'refs'}
    <ReferencesPanel {editor} />
  {:else}
    {#await import('./ViewMenu.svelte') then { default: ViewMenu }}<ViewMenu {editor} />{/await}
  {/if}
{/snippet}

{#if asSheet}
  {#if sheet}
    <section class="sheet" aria-label={TITLES[sheet]}>
      <header>
        <div class="seg tabs" role="tablist">
          {#each ['palette', 'scene', 'layers', 'refs', 'assets', 'view'] as const as s (s)}
            <button
              type="button"
              role="tab"
              aria-selected={sheet === s}
              class:on={sheet === s}
              onclick={() => onSheet?.(s)}>{TITLES[s]}</button
            >
          {/each}
        </div>
        <button type="button" class="btn icon" aria-label="Close" onclick={() => onSheet?.(null)}>
          <Icon name="close" />
        </button>
      </header>
      <div class="content">{@render body(sheet)}</div>
    </section>
  {/if}
{:else}
  <aside class="dock" aria-label="Palette and scene" style:width="{$ui.sideWidth}px">
    <div
      class="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={SIDE_WIDTH.min}
      aria-valuemax={SIDE_WIDTH.max}
      aria-valuenow={$ui.sideWidth}
      data-tip="Drag for width, double-click to reset"
      onpointerdown={resize}
      ondblclick={() => editor.ui.update((u) => ({ ...u, sideWidth: SIDE_WIDTH.initial }))}
    ></div>
    <div class="scroll">
      {#each DOCKED as s (s)}
        <section class="section" class:folded={folded.has(s)} class:grow={s === 'scene'}>
          <button type="button" class="head" aria-expanded={!folded.has(s)} onclick={() => toggle(s)}>
            <svg class="chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 8 L10 12 L14 8" /></svg>
            {TITLES[s]}
          </button>
          {#if !folded.has(s)}
            <div class="content">{@render body(s)}</div>
          {/if}
        </section>
      {/each}
    </div>
  </aside>
{/if}

<style>
  .dock {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: none;
    min-height: 0;
    background: var(--surface);
    border-left: 1px solid var(--line);
  }
  .scroll {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -4px;
    z-index: 2;
    width: 8px;
    cursor: ew-resize;
    touch-action: none;
  }
  .resizer:hover::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 2px;
    background: var(--accent);
  }
  .section {
    display: flex;
    flex-direction: column;
  }
  .section + .section {
    border-top: 1px solid var(--line);
  }
  .section.grow:not(.folded) {
    flex: 1 0 auto;
    min-height: 160px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 10px;
    border: 0;
    background: none;
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-align: left;
    cursor: pointer;
  }
  .head:hover {
    color: var(--text);
  }
  .head:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .chev {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    transition: rotate 0.15s;
  }
  .folded .chev {
    rotate: -90deg;
  }
  .sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 6;
    display: flex;
    flex-direction: column;
    max-height: 62%;
    border-radius: 14px 14px 0 0;
    background: var(--surface);
    box-shadow: 0 -10px 30px rgb(0 0 0 / 40%);
  }
  .sheet header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 4px 12px;
  }
  .tabs {
    flex: 1;
  }
  .tabs > button {
    flex: 1;
  }
  .sheet .content {
    overflow-y: auto;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .sheet :global(.menu) {
    width: auto;
  }
</style>
