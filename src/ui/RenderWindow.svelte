<script lang="ts">
  import type { Editor } from '../app/editor';
  import Icon from './Icon.svelte';

  /**
   * The render window over the editing view (docs/rendering.md, “Render window”): the
   * path-traced picture is drawn into the canvas under its transparent middle, and follows the
   * edits. The header moves it; the picture can keep its own view while the camera moves on.
   */
  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const open = $derived(editor.renderWindow);
  const rendering = $derived(editor.rendering);
  const status = $derived(editor.renderWindowStatus);
  const settings = $derived(editor.renderSettings);
  const pinned = $derived(editor.renderWindowView);
  const frame = $derived(editor.frameSize);

  const WIDTHS = [200, 300, 440];
  // A phone starts with the small window: the view is narrow.
  let size = $state(typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches ? 0 : 1);
  let pos = $state({ x: 12, y: 12 });
  let hole = $state<HTMLElement>();
  let box = $state<HTMLElement>();

  $effect(() => {
    if (!hole) return;
    editor.setRenderWindowElement(hole);
    return () => editor.setRenderWindowElement(null);
  });

  // The picture has the shape of the saved frame, within reason.
  const width = $derived(WIDTHS[size]!);
  const height = $derived(
    Math.round(width * Math.min(1.5, Math.max(0.4, $frame.height / Math.max(1, $frame.width)))),
  );

  /** Keeps the window inside the view. */
  function clamp(x: number, y: number): { x: number; y: number } {
    const parent = box?.parentElement;
    if (!parent || !box) return { x, y };
    const maxX = Math.max(0, parent.clientWidth - box.offsetWidth);
    const maxY = Math.max(0, parent.clientHeight - box.offsetHeight);
    return { x: Math.max(0, Math.min(maxX, x)), y: Math.max(0, Math.min(maxY, y)) };
  }

  function drag(e: PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const start = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const move = (m: PointerEvent) => {
      pos = clamp(m.clientX - start.x, m.clientY - start.y);
      editor.requestFrame();
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  function resize() {
    size = (size + 1) % WIDTHS.length;
    // After the new size is laid out: stay inside the view and draw there.
    requestAnimationFrame(() => {
      pos = clamp(pos.x, pos.y);
      editor.requestFrame();
    });
  }
</script>

{#if $open && !$rendering}
  <div class="win" bind:this={box} style:left="{pos.x}px" style:top="{pos.y}px" style:width="{width}px">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header onpointerdown={drag}>
      <span class="title">Render</span>
      <span class="num">
        {#if !$status.problem}{$status.samples}/{$settings.samples}{/if}
      </span>
      <button
        type="button"
        class="btn icon"
        class:on={$pinned !== null}
        aria-pressed={$pinned !== null}
        data-tip={$pinned ? 'View pinned: the window does not follow the camera' : 'Pin the view: you can keep turning the camera'}
        onclick={() => editor.pinRenderWindow($pinned === null)}
      >
        <Icon name="pin" />
      </button>
      <button type="button" class="btn icon" data-tip="Window size" onclick={resize}>
        <Icon name="resize" />
      </button>
      <button type="button" class="btn icon" data-tip="Fill the view (Render mode)" onclick={() => editor.setRendering(true)}>
        <Icon name="expand" />
      </button>
      <button type="button" class="btn icon" data-tip="Close the render window" onclick={() => editor.toggleRenderWindow(false)}>
        <Icon name="close" />
      </button>
    </header>
    <!-- The canvas shows through: the picture is drawn there, under this box. -->
    <div class="frame">
      <div class="hole" bind:this={hole} style:height="{height}px">
        {#if $status.problem}<p>{$status.problem}</p>{/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* Only the header and the rim are painted: anything behind the picture would hide it. */
  .win {
    position: absolute;
    z-index: 4;
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    box-shadow: var(--shadow-float);
  }
  header {
    display: flex;
    border-radius: 10px 10px 0 0;
    background: var(--float);
    align-items: center;
    gap: 2px;
    padding: 2px 2px 2px 10px;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  header:active {
    cursor: grabbing;
  }
  .title {
    font-weight: 600;
  }
  .num {
    flex: 1;
    min-width: 0;
    padding-left: 6px;
    color: var(--text-faint);
    font: 11px var(--mono);
    white-space: nowrap;
  }
  .btn.icon {
    width: 28px;
    height: 28px;
    min-width: 28px;
  }
  .btn :global(.icon) {
    width: 16px;
    height: 16px;
  }
  .frame {
    border: 4px solid var(--float);
    border-top: 0;
    border-radius: 0 0 10px 10px;
  }
  .hole {
    position: relative;
  }
  .hole p {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    padding: 8px;
    color: var(--text-dim);
    font-size: 12px;
    text-align: center;
  }
</style>
