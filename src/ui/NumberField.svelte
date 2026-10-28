<script lang="ts">
  import { dragRate, evaluateNumber, snapNumber } from '../app/number-expr';

  interface Props {
    value: number;
    /** A new value; `live` while dragging (one undo step for the whole drag). */
    onChange: (value: number, live: boolean) => void;
    /** A drag or an edit is over. */
    onEnd?: () => void;
    min?: number;
    max?: number;
    step?: number;
    /** Digits after the point when shown. */
    decimals?: number;
    /** Double click puts this value back. */
    reset?: number;
    suffix?: string;
    label: string;
    tip?: string;
  }
  const {
    value,
    onChange,
    onEnd,
    min = -Infinity,
    max = Infinity,
    step = 1,
    decimals = 0,
    reset,
    suffix = '',
    label,
    tip,
  }: Props = $props();

  let input = $state<HTMLInputElement>();
  let editing = $state(false);
  let text = $state('');
  let invalid = $state(false);
  let dragging = $state(false);

  const shown = $derived(`${value.toFixed(decimals)}${suffix}`);

  /** Ends typing once (Enter blurs, and the blur must not apply «+5» a second time). */
  function finish(): void {
    if (!editing) return;
    editing = false;
    commit();
  }

  function commit(): void {
    const next = evaluateNumber(text, value);
    if (next === null) {
      invalid = true;
      setTimeout(() => (invalid = false), 400);
    } else {
      onChange(snapNumber(next, step, min, max), false);
    }
    onEnd?.();
  }

  function startEditing(): void {
    editing = true;
    text = value.toFixed(decimals);
    queueMicrotask(() => input?.select());
  }

  // A press then a sideways drag scrubs the value; a press without one starts typing.
  function down(e: PointerEvent): void {
    if (editing || e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    let lastX = e.clientX;
    let exact = value;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;
      moved = true;
      dragging = true;
      exact += (ev.clientX - lastX) * dragRate(step, { shift: ev.shiftKey, ctrl: ev.ctrlKey || ev.metaKey });
      lastX = ev.clientX;
      exact = Math.min(max, Math.max(min, exact));
      const next = snapNumber(exact, step, min, max);
      if (next !== value) onChange(next, true);
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      dragging = false;
      if (moved) onEnd?.();
      // Focusing starts typing.
      else if (ev.type === 'pointerup') input?.focus();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function key(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish();
      input?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      editing = false;
      input?.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
      const next = snapNumber(value + delta, step, min, max);
      onChange(next, false);
      onEnd?.();
      text = next.toFixed(decimals);
      queueMicrotask(() => input?.select());
    }
  }
</script>

<input
  bind:this={input}
  class="num"
  class:invalid
  class:dragging
  type="text"
  inputmode="decimal"
  spellcheck="false"
  autocomplete="off"
  aria-label={label}
  data-tip={tip ?? `${label}: drag sideways, Shift — faster, Ctrl — finer; you can type +5, *2${reset !== undefined ? '; double-click — reset' : ''}`}
  value={editing ? text : shown}
  readonly={!editing}
  onpointerdown={down}
  onfocus={() => {
    if (!editing) startEditing();
  }}
  oninput={(e) => (text = e.currentTarget.value)}
  onblur={finish}
  onkeydown={key}
  ondblclick={() => {
    if (reset === undefined) return;
    editing = false;
    onChange(reset, false);
    onEnd?.();
    input?.blur();
  }}
/>

<style>
  .num {
    width: 100%;
    min-width: 0;
    height: 26px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-s);
    background: var(--surface-2);
    color: var(--text);
    font: 12px var(--mono);
    text-align: right;
    cursor: ew-resize;
    touch-action: pan-y;
  }
  .num:hover {
    border-color: var(--line-strong);
  }
  .num:not([readonly]) {
    border-color: var(--accent);
    background: var(--bg);
    text-align: left;
    cursor: text;
    outline: none;
  }
  .num.dragging {
    border-color: var(--accent);
  }
  .num.invalid {
    border-color: #e5484d;
  }
  @media (pointer: coarse) {
    .num {
      height: 34px;
    }
  }
</style>
