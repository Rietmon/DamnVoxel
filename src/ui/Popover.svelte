<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** The element the popover hangs from. */
    anchor: HTMLElement;
    onClose: () => void;
    /** Below the anchor (default), or to its right. */
    placement?: 'below' | 'right';
    /** Edge of the anchor the popover lines up with when below it. */
    align?: 'start' | 'end';
    label: string;
    children: Snippet;
  }
  const { anchor, onClose, placement = 'below', align = 'start', label, children }: Props = $props();

  let box = $state<HTMLElement>();
  let pos = $state({ left: 0, top: 0, maxHeight: 400 });

  // Placed next to the anchor and kept inside the window: slid up when it would run past the
  // bottom, or put above the anchor when there is more room there.
  $effect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = box?.offsetWidth ?? 280;
      const h = box?.scrollHeight ?? 0;
      const margin = 8;
      const room = window.innerHeight - 2 * margin;
      let left: number;
      let top: number;
      if (placement === 'right') {
        left = r.right + 8;
        top = Math.min(r.top, window.innerHeight - margin - h);
      } else {
        left = align === 'end' ? r.right - w : r.left;
        top = r.bottom + 6;
        const below = window.innerHeight - margin - top;
        const above = r.top - 6 - margin;
        if (h > below && above > below) top = Math.max(margin, r.top - 6 - h);
      }
      left = Math.max(margin, Math.min(window.innerWidth - w - margin, left));
      top = Math.max(margin, top);
      pos = { left, top, maxHeight: Math.min(room, window.innerHeight - top - margin) };
    };
    place();
    // The content decides the size, and it changes (a colour editor opening its picker).
    const observer = new ResizeObserver(place);
    if (box) observer.observe(box.firstElementChild ?? box);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  });

  $effect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
        return;
      }
      const target = e.target as Node;
      if (!box?.contains(target) && !anchor.contains(target)) onClose();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
    };
  });
</script>

<div
  class="popover float"
  role="dialog"
  aria-label={label}
  bind:this={box}
  style:left="{pos.left}px"
  style:top="{pos.top}px"
  style:max-height="{pos.maxHeight}px"
>
  {@render children()}
</div>

<style>
  .popover {
    position: fixed;
    z-index: 40;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>
