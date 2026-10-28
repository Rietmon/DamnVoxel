<script lang="ts">
  /**
   * One tooltip for the whole app: any element with `data-tip` (and optionally `data-key`) gets
   * «Name · key» after a short hover, at once on keyboard focus. Styled like the rest, unlike
   * the browser's title, and never on touch, where hover does not exist.
   */
  let tip = $state<{
    text: string;
    key: string;
    x: number;
    y: number;
    side: 'above' | 'below' | 'right';
  } | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: Element | null = null;

  function show(el: Element, delay: number): void {
    if (timer) clearTimeout(timer);
    current = el;
    timer = setTimeout(() => {
      if (current !== el || !el.isConnected) return;
      const r = el.getBoundingClientRect();
      const text = el.getAttribute('data-tip') ?? '';
      const key = el.getAttribute('data-key') ?? '';
      // Along the left edge the tip goes to the right; near the top, below; else above.
      if (el.getAttribute('data-tip-side') === 'right') {
        tip = { text, key, x: r.right + 10, y: r.top + r.height / 2, side: 'right' };
      } else {
        const x = Math.min(window.innerWidth - 140, Math.max(140, r.left + r.width / 2));
        const below = r.top < 48;
        tip = { text, key, x, y: below ? r.bottom + 8 : r.top - 8, side: below ? 'below' : 'above' };
      }
    }, delay);
  }

  function hide(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    current = null;
    if (tip !== null) tip = null;
  }

  $effect(() => {
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as Element | null)?.closest?.('[data-tip]');
      if (el === current) return;
      if (el) show(el, 400);
      else hide();
    };
    const focus = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]');
      if (el && (e.target as HTMLElement).matches(':focus-visible')) show(el, 0);
    };
    window.addEventListener('pointerover', over);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('focusin', focus);
    // Focus also leaves when Svelte removes a focused field, in the middle of its update:
    // state may not change there, so the tooltip goes a moment later.
    const blur = () => queueMicrotask(hide);
    window.addEventListener('focusout', blur);
    window.addEventListener('wheel', hide, { passive: true });
    return () => {
      window.removeEventListener('pointerover', over);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('focusin', focus);
      window.removeEventListener('focusout', blur);
      window.removeEventListener('wheel', hide);
    };
  });
</script>

{#if tip && tip.text}
  <div
    class="tip"
    class:below={tip.side === 'below'}
    class:right={tip.side === 'right'}
    role="tooltip"
    style:left="{tip.x}px"
    style:top="{tip.y}px"
  >
    {tip.text}
    {#if tip.key}<kbd>{tip.key}</kbd>{/if}
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 320px;
    padding: 5px 8px;
    border-radius: 6px;
    background: #0e0f12;
    color: var(--text);
    font-size: 12px;
    pointer-events: none;
    translate: -50% -100%;
    box-shadow: 0 4px 14px rgb(0 0 0 / 40%);
  }
  .tip.below {
    translate: -50% 0;
  }
  .tip.right {
    translate: 0 -50%;
  }
</style>
