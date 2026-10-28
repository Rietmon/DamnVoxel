<script lang="ts">
  import type { Editor } from '../app/editor';
  import { RADIAL_DEAD_ZONE, RADIAL_ITEMS, radialOffset } from '../app/radial';
  import Icon from './Icon.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const radial = $derived(editor.radial);
  let layer = $state<HTMLElement>();

  const count = RADIAL_ITEMS.length;
  const key = (id: string) => editor.actions.shortcut(id) ?? '';
  const label = $derived(
    $radial && $radial.hover >= 0 ? RADIAL_ITEMS[$radial.hover]!.title : 'Where to?',
  );

  // Opened by the key: the mouse points without a press, releasing the key on an item picks it.
  $effect(() => {
    if (!$radial || $radial.dragging) return;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !layer) return;
      const r = layer.getBoundingClientRect();
      editor.pointRadial(e.clientX - r.left, e.clientY - r.top);
    };
    const keyUp = (e: KeyboardEvent) => {
      const r = editor.radial.get();
      if (e.code === 'Backquote' && r && r.hover >= 0) editor.pickRadial(r.hover);
    };
    const keyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.stopPropagation();
      editor.pickRadial(-1);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('keydown', keyDown, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('keydown', keyDown, true);
    };
  });
</script>

{#if $radial}
  <div
    class="layer"
    class:passive={$radial.dragging}
    bind:this={layer}
    role="presentation"
    onpointerdown={(e) => {
      if (e.target === layer) editor.pickRadial(-1);
    }}
  >
    <div class="ring" style:left="{$radial.x}px" style:top="{$radial.y}px" role="menu" aria-label="Radial menu">
      <div class="hub" style:width="{RADIAL_DEAD_ZONE * 2 + 40}px" style:height="{RADIAL_DEAD_ZONE * 2 + 40}px">
        {label}
      </div>
      {#each RADIAL_ITEMS as item, i (item.id)}
        {@const [dx, dy] = radialOffset(i, count)}
        <button
          type="button"
          role="menuitem"
          class="item"
          class:on={$radial.hover === i}
          style:left="{dx}px"
          style:top="{dy}px"
          data-key={item.id.includes('.') ? key(item.id) : ''}
          onclick={() => editor.pickRadial(i)}
        >
          <Icon name={item.icon} />
          <span>{item.title}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .layer {
    position: absolute;
    inset: 0;
    z-index: 20;
    background: rgb(0 0 0 / 18%);
  }
  /* While the opening finger or pen is down, it drives the menu through the canvas. */
  .passive {
    pointer-events: none;
  }
  .ring {
    position: absolute;
    width: 0;
    height: 0;
  }
  .hub {
    position: absolute;
    display: grid;
    place-items: center;
    translate: -50% -50%;
    padding: 6px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: 0 6px 24px rgb(0 0 0 / 45%);
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.2;
    text-align: center;
  }
  .item {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 72px;
    height: 56px;
    translate: -50% -50%;
    border: 0;
    border-radius: 14px;
    background: var(--surface);
    box-shadow: 0 6px 24px rgb(0 0 0 / 45%);
    color: var(--text);
    font-size: 11px;
    cursor: pointer;
    transition:
      scale 0.08s,
      background 0.08s;
  }
  .item:hover,
  .item.on {
    background: var(--accent);
    color: var(--accent-text);
    scale: 1.08;
  }
  .item:focus-visible {
    outline: 2px solid var(--accent);
  }
</style>
