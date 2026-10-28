<script lang="ts">
  import type { Editor } from '../app/editor';
  import type { RenderSettings } from '../app/render-scene';
  import NumberField from './NumberField.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const s = $derived(editor.renderSettings);
  const environment = $derived(editor.environment);
  let envInput = $state<HTMLInputElement>();
  const set = (patch: Partial<RenderSettings>) => editor.renderSettings.update((v) => ({ ...v, ...patch }));
  type NumKey = { [K in keyof RenderSettings]: RenderSettings[K] extends number ? K : never }[keyof RenderSettings];
  const ROWS: { key: NumKey; title: string; min: number; max: number; step: number; decimals: number }[] = [
    { key: 'samples', title: 'Samples', min: 1, max: 8192, step: 1, decimals: 0 },
    { key: 'bounces', title: 'Bounces', min: 1, max: 8, step: 1, decimals: 0 },
    { key: 'sunStrength', title: 'Sun strength', min: 0, max: 20, step: 0.1, decimals: 1 },
    { key: 'sunSize', title: 'Sun size', min: 0.1, max: 20, step: 0.1, decimals: 1 },
    { key: 'skyStrength', title: 'Sky brightness', min: 0, max: 10, step: 0.05, decimals: 2 },
  ];
</script>

<div class="menu">
  <section>
    {#each ROWS as r (r.key)}
      <label class="row">
        <span>{r.title}</span>
        <NumberField
          label={r.title}
          value={$s[r.key]}
          min={r.min}
          max={r.max}
          step={r.step}
          decimals={r.decimals}
          onChange={(v) => set({ [r.key]: v })}
        />
      </label>
    {/each}
  </section>
  <section>
    <h3>Camera and film</h3>
    <label class="row">
      <span>Blur (lens)</span>
      <NumberField label="Lens radius" value={$s.aperture} min={0} max={8} step={0.05} decimals={2} reset={0} onChange={(v) => set({ aperture: v })} />
    </label>
    <label class="row">
      <span>Focus</span>
      <NumberField label="Focus distance" value={$s.focus} min={1} max={2000} step={0.5} decimals={1} onChange={(v) => set({ focus: v })} />
    </label>
    <p class="hint">Click the model in the render to focus there.</p>
    <label class="row">
      <span>Bloom</span>
      <NumberField label="Bloom of bright spots" value={$s.bloom} min={0} max={2} step={0.05} decimals={2} reset={0} onChange={(v) => set({ bloom: v })} />
    </label>
    <div class="seg wide" role="radiogroup" aria-label="Tone curve">
      <button type="button" role="radio" aria-checked={$s.tonemap === 'aces'} class:on={$s.tonemap === 'aces'} onclick={() => set({ tonemap: 'aces' })}>ACES film</button>
      <button type="button" role="radio" aria-checked={$s.tonemap === 'none'} class:on={$s.tonemap === 'none'} onclick={() => set({ tonemap: 'none' })}>No curve</button>
    </div>
    <label class="check"><input type="checkbox" checked={$s.denoise} onchange={(e) => set({ denoise: e.currentTarget.checked })} />Denoise</label>
  </section>
  <section>
    <h3>Environment</h3>
    <div class="line">
      <button type="button" class="btn" onclick={() => envInput?.click()}>.hdr panorama…</button>
      {#if $environment}
        <span class="file" title={$environment}>{$environment}</span>
        <button type="button" class="btn" onclick={() => editor.clearEnvironment()}>Remove</button>
      {:else}
        <span class="hint">sky is the gradient below</span>
      {/if}
    </div>
    <input
      bind:this={envInput}
      type="file"
      accept=".hdr"
      hidden
      onchange={(e) => {
        const f = e.currentTarget.files?.[0];
        if (f) void editor.loadEnvironment(f);
        e.currentTarget.value = '';
      }}
    />
  </section>
  <section>
    <h3>Fog</h3>
    <label class="row">
      <span>Density</span>
      <NumberField label="Fog density" value={$s.fog} min={0} max={0.2} step={0.002} decimals={3} reset={0} onChange={(v) => set({ fog: v })} />
    </label>
    <label class="color"><input type="color" value={$s.fogColor} oninput={(e) => set({ fogColor: e.currentTarget.value })} />Fog color</label>
  </section>
  <section>
    <h3>Sky and ground</h3>
    <div class="colors">
      <label class="color"><input type="color" value={$s.skyZenith} oninput={(e) => set({ skyZenith: e.currentTarget.value })} />Zenith</label>
      <label class="color"><input type="color" value={$s.skyHorizon} oninput={(e) => set({ skyHorizon: e.currentTarget.value })} />Horizon</label>
      <label class="color"><input type="color" value={$s.groundColor} oninput={(e) => set({ groundColor: e.currentTarget.value })} />Ground</label>
      <label class="check"><input type="checkbox" checked={$s.ground} onchange={(e) => set({ ground: e.currentTarget.checked })} />Ground under the model</label>
    </div>
  </section>
</div>

<style>
  .menu {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 300px;
    padding: 12px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  h3 {
    margin: 4px 0 0;
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 500;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 72px;
    align-items: center;
    gap: 8px;
    color: var(--text-dim);
  }
  .wide {
    display: flex;
  }
  .wide > button {
    flex: 1;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .file {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    color: var(--text-faint);
    font-size: 12px;
  }
  .colors {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .color,
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    color: var(--text);
    cursor: pointer;
  }
  .color input {
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 5px;
    background: none;
  }
  .check input {
    accent-color: var(--accent);
  }
</style>
