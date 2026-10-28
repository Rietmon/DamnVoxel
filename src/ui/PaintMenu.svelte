<script lang="ts">
  import type { Editor } from '../app/editor';
  import { toHex } from '../core/color';
  import { PATTERN_TITLES, type PaintPattern, SHADE_TITLES, type Shade } from '../core/paint';
  import NumberField from './NumberField.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const tools = $derived(editor.tools);
  const settings = $derived(tools.settingsStore);
  const selection = $derived(editor.paletteSelection);
  const paletteVersion = $derived(editor.paletteVersion);

  const PATTERNS = Object.keys(PATTERN_TITLES) as PaintPattern[];
  const SHADES = Object.keys(SHADE_TITLES) as Shade[];
  const AXES = ['X', 'Y', 'Z'] as const;

  const ramp = $derived.by(() => {
    void $selection;
    void $paletteVersion;
    void $settings.color;
    return tools.paintRamp();
  });
  const css = (id: number) => {
    void $paletteVersion;
    return toHex(editor.doc.palette.color(id));
  };
  const set = (patch: Parameters<typeof tools.updateSettings>[0]) => tools.updateSettings(patch);
</script>

<div class="menu">
  <section>
    <h3>Pattern</h3>
    <select
      class="select"
      aria-label="Paint pattern"
      value={$settings.paintPattern}
      onchange={(e) => set({ paintPattern: e.currentTarget.value as PaintPattern })}
    >
      {#each PATTERNS as p (p)}<option value={p}>{PATTERN_TITLES[p]}</option>{/each}
    </select>
    {#if $settings.paintPattern === 'gradient'}
      <div class="row">
        <span>Along</span>
        <div class="seg" role="radiogroup" aria-label="Gradient axis">
          {#each AXES as a, i (a)}
            <button
              type="button"
              role="radio"
              aria-checked={$settings.gradientAxis === i}
              class:on={$settings.gradientAxis === i}
              onclick={() => set({ gradientAxis: i as 0 | 1 | 2 })}>{a}</button
            >
          {/each}
        </div>
      </div>
    {:else if $settings.paintPattern !== 'solid' && $settings.paintPattern !== 'random' && $settings.paintPattern !== 'splatter'}
      <label class="row">
        <span>Spot size</span>
        <span class="num">
          <NumberField
            label="Spot size"
            value={$settings.patternScale}
            min={1}
            max={64}
            reset={6}
            onChange={(v) => set({ patternScale: v })}
          />
        </span>
      </label>
    {/if}
    {#if $settings.paintPattern !== 'solid'}
      <div class="ramp" aria-label="Pattern colors">
        {#each $settings.paintPattern === 'splatter' ? ramp.slice(Math.max(0, ramp.indexOf($settings.color) - 1), ramp.indexOf($settings.color) + 2) : ramp as id (id)}
          <span class="chip" style:background={css(id)}></span>
        {/each}
      </div>
      <p class="note">
        {$selection.length >= 2
          ? 'Colors are the ones selected in the palette, in order.'
          : 'Colors are the neighbors of the current one in the palette. Select your own ramp in the palette (Shift+click).'}
      </p>
    {/if}
  </section>
  <section>
    <h3>Tone while painting</h3>
    <div class="seg wide" role="radiogroup" aria-label="Tone">
      <button
        type="button"
        role="radio"
        aria-checked={$settings.shade === 'none'}
        class:on={$settings.shade === 'none'}
        onclick={() => set({ shade: 'none' })}>Color</button
      >
      {#each SHADES as s (s)}
        <button
          type="button"
          role="radio"
          aria-checked={$settings.shade === s}
          class:on={$settings.shade === s}
          onclick={() => set({ shade: s, action: 'paint' })}>{SHADE_TITLES[s]}</button
        >
      {/each}
    </div>
    {#if $settings.shade !== 'none'}
      <div class="seg wide" role="radiogroup" aria-label="Where the tone comes from">
        <button
          type="button"
          role="radio"
          aria-checked={$settings.shadeBy === 'palette'}
          class:on={$settings.shadeBy === 'palette'}
          data-tip="The neighbor color in the palette: ramps sit side by side"
          onclick={() => set({ shadeBy: 'palette' })}>By palette</button
        >
        <button
          type="button"
          role="radio"
          aria-checked={$settings.shadeBy === 'hsl'}
          class:on={$settings.shadeBy === 'hsl'}
          data-tip="The color shifts in lightness or hue and the nearest one from the palette is taken"
          onclick={() => set({ shadeBy: 'hsl' })}>By HSL</button
        >
      </div>
      <p class="note">Every voxel takes its own color one step lighter, darker, warmer or cooler.</p>
    {/if}
  </section>
  <section>
    <h3>Color lock</h3>
    <label class="check">
      <input
        type="checkbox"
        checked={$settings.colorLock.length > 0}
        onchange={() => editor.actions.run('paint.lock')}
      />
      <span>Paint and erase only over</span>
      {#each $settings.colorLock as id (id)}
        <span class="chip" style:background={css(id)}></span>
      {/each}
    </label>
    {#if $settings.colorLock.length === 0}
      <p class="note">The lock takes the colors selected in the palette, or the current one.</p>
    {/if}
  </section>
</div>

<style>
  .menu {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 340px;
    padding: 12px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h3 {
    margin: 0;
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 500;
  }
  .select {
    height: 28px;
    border: 0;
    border-radius: var(--radius-s);
    background: var(--surface-2);
    color: var(--text);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--text-dim);
  }
  .num {
    width: 64px;
  }
  .wide {
    display: flex;
    flex-wrap: wrap;
  }
  .wide > button {
    flex: 1;
  }
  .ramp {
    display: flex;
    gap: 3px;
  }
  .chip {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 20%);
  }
  .check {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .check input {
    margin: 0;
    accent-color: var(--accent);
  }
  .note {
    margin: 0;
    color: var(--text-faint);
    font-size: 12px;
  }
</style>
