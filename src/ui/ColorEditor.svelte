<script lang="ts">
  import type { Editor } from '../app/editor';
  import { setPaletteColors } from '../app/palette-actions';
  import {
    alpha,
    blue,
    fromHex,
    green,
    type Hsv,
    hsvToRgb,
    packRgba,
    red,
    rgbToHsv,
    toHex,
  } from '../core/color';
  import { shiftLike } from '../core/palette-edit';
  import NumberField from './NumberField.svelte';

  interface Props {
    editor: Editor;
    /** The palette entry being edited. */
    id: number;
  }
  const { editor, id }: Props = $props();
  const version = $derived(editor.paletteVersion);
  const selection = $derived(editor.paletteSelection);
  /**
   * Entries an edit changes: all selected ones when the edited colour is among them (they move
   * together by the same HSV step), otherwise just this one. Never the whole palette by itself.
   */
  const targets = $derived($selection.length > 1 && $selection.includes(id) ? $selection : [id]);
  /** Colours of the targets when the current gesture began. */
  let base: Map<number, number> | null = null;

  const colour = $derived.by(() => {
    void $version;
    return editor.doc.palette.color(id);
  });
  /**
   * Kept apart from the colour: a grey has no hue, and dragging value down to black and back
   * must not lose the hue or the saturation the user had.
   */
  let hsv = $state<Hsv>({ h: 0, s: 0, v: 0 });
  let written = -1;
  $effect(() => {
    if (colour !== written) {
      hsv = rgbToHsv(red(colour), green(colour), blue(colour));
      written = colour;
    }
  });
  let hexText = $state('');
  $effect(() => {
    hexText = toHex(colour);
  });

  function write(next: number, merge: boolean): void {
    written = next;
    const ids = targets;
    if (ids.length === 1) {
      setPaletteColors(editor, [id], [next], merge);
      return;
    }
    const palette = editor.doc.palette;
    if (!base || !merge) base = new Map(ids.map((i) => [i, palette.color(i)]));
    const start = base;
    const from = start.get(id)!;
    const colours = ids.map((i) => (i === id ? next : shiftLike(start.get(i)!, from, next)));
    setPaletteColors(editor, ids, colours, merge);
    if (!merge) base = null;
  }

  /** The gesture is over: the next edit is a new step from the colours as they are then. */
  function endGesture(): void {
    base = null;
    editor.doc.history.closeMerge();
  }

  function setHsv(next: Hsv, merge: boolean): void {
    hsv = next;
    const [r, g, b] = hsvToRgb(next);
    write(packRgba(r, g, b, alpha(colour)), merge);
  }

  function setRgb(r: number, g: number, b: number, merge: boolean): void {
    const next = packRgba(r, g, b, alpha(colour));
    const h = rgbToHsv(r, g, b);
    // Keep the hue while the colour is grey.
    hsv = h.s === 0 ? { ...h, h: hsv.h } : h;
    write(next, merge);
  }

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  /** Dragging in the square or along the hue bar: one step of history per drag. */
  function track(e: PointerEvent, apply: (fx: number, fy: number) => void): void {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    endGesture();
    const at = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      apply(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      endGesture();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  type Field = 'h' | 's' | 'v' | 'r' | 'g' | 'b';
  const FIELDS: { key: Field; label: string; max: number }[] = [
    { key: 'h', label: 'H', max: 360 },
    { key: 's', label: 'S', max: 100 },
    { key: 'v', label: 'V', max: 100 },
    { key: 'r', label: 'R', max: 255 },
    { key: 'g', label: 'G', max: 255 },
    { key: 'b', label: 'B', max: 255 },
  ];
  const fieldValue = (key: Field): number => {
    if (key === 'h') return Math.round(hsv.h);
    if (key === 's') return Math.round(hsv.s * 100);
    if (key === 'v') return Math.round(hsv.v * 100);
    return key === 'r' ? red(colour) : key === 'g' ? green(colour) : blue(colour);
  };

  function onField(key: Field, n: number): void {
    const max = FIELDS.find((f) => f.key === key)!.max;
    const v = clamp(Math.round(n), 0, max);
    if (key === 'h') setHsv({ ...hsv, h: v % 360 }, true);
    else if (key === 's') setHsv({ ...hsv, s: v / 100 }, true);
    else if (key === 'v') setHsv({ ...hsv, v: v / 100 }, true);
    else {
      const rgb = [red(colour), green(colour), blue(colour)] as [number, number, number];
      rgb['rgb'.indexOf(key)] = v;
      setRgb(...rgb, true);
    }
  }

  function onHex(): void {
    const c = fromHex(hexText, alpha(colour));
    if (c === null) {
      hexText = toHex(colour);
      return;
    }
    endGesture();
    setRgb(red(c), green(c), blue(c), false);
  }

  async function copyHex(): Promise<void> {
    const hex = toHex(colour);
    try {
      await navigator.clipboard.writeText(hex);
      editor.toast(`Copied: ${hex}`);
    } catch {
      editor.toast(`Could not copy ${hex}`);
    }
  }

  const hueColour = $derived(toHex(packRgba(...hsvToRgb({ h: hsv.h, s: 1, v: 1 }))));
</script>

<div class="editor">
  {#if targets.length > 1}
    <p class="scope">
      Colors selected: {targets.length}. All shift the same way as this one.
      <button type="button" onclick={() => editor.selectColors([id], id)}>Only this one</button>
    </p>
  {/if}
  <div
    class="sv"
    style:--hue={hueColour}
    role="slider"
    tabindex="0"
    aria-label="Saturation and brightness"
    aria-valuetext="S {Math.round(hsv.s * 100)}, V {Math.round(hsv.v * 100)}"
    aria-valuenow={Math.round(hsv.s * 100)}
    onpointerdown={(e) => track(e, (fx, fy) => setHsv({ ...hsv, s: fx, v: 1 - fy }, true))}
  >
    <span class="knob" style:left="{hsv.s * 100}%" style:top="{(1 - hsv.v) * 100}%"></span>
  </div>
  <div
    class="hue"
    role="slider"
    tabindex="0"
    aria-label="Hue"
    aria-valuemin={0}
    aria-valuemax={360}
    aria-valuenow={Math.round(hsv.h)}
    onpointerdown={(e) => track(e, (fx) => setHsv({ ...hsv, h: fx * 360 }, true))}
  >
    <span class="knob" style:left="{(hsv.h / 360) * 100}%"></span>
  </div>
  <div class="fields">
    {#each FIELDS as f (f.key)}
      <label>
        <span>{f.label}</span>
        <NumberField
          label={f.label}
          min={0}
          max={f.max}
          value={fieldValue(f.key)}
          onChange={(v) => onField(f.key, v)}
          onEnd={endGesture}
        />
      </label>
    {/each}
  </div>
  <div class="hex">
    <span class="swatch" style:background={toHex(colour)}></span>
    <input
      aria-label="Color in hex"
      spellcheck="false"
      bind:value={hexText}
      onkeydown={(e) => {
        if (e.key === 'Enter') onHex();
      }}
      onblur={onHex}
    />
    <button type="button" title="Copy hex" onclick={copyHex}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 7 H16 V16 H7 Z M4 13 V4 H13" /></svg>
      Copy
    </button>
  </div>
</div>

<style>
  .editor {
    display: grid;
    gap: 8px;
    padding: 8px 6px 8px;
    border-top: 1px solid var(--border);
  }
  .scope {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
  }
  .sv {
    position: relative;
    height: 120px;
    border-radius: 4px;
    background:
      linear-gradient(to top, #000, transparent),
      linear-gradient(to right, #fff, var(--hue));
    touch-action: none;
    cursor: crosshair;
  }
  .hue {
    position: relative;
    height: 14px;
    border-radius: 7px;
    background: linear-gradient(
      to right,
      #f00 0%,
      #ff0 16.67%,
      #0f0 33.33%,
      #0ff 50%,
      #00f 66.67%,
      #f0f 83.33%,
      #f00 100%
    );
    touch-action: none;
    cursor: ew-resize;
  }
  .knob {
    position: absolute;
    width: 12px;
    height: 12px;
    border: 2px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 70%);
    translate: -50% -50%;
    pointer-events: none;
  }
  .hue .knob {
    top: 50%;
  }
  .sv:focus-visible,
  .hue:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px 6px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-dim);
    font: 12px var(--mono);
  }
  input {
    width: 100%;
    min-width: 0;
    height: 26px;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    font: 12px var(--mono);
  }
  input:focus {
    border-color: var(--accent);
    outline: none;
  }
  .hex {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: 4px;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 25%);
  }
  .hex input {
    flex: 1;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--panel-raised);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }
  button:hover {
    border-color: var(--border-strong);
  }
  svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
  }
  @media (pointer: coarse) {
    input,
    button,
    .swatch {
      height: 34px;
    }
    .hue {
      height: 22px;
      border-radius: 11px;
    }
  }
</style>
