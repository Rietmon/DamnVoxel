<script lang="ts">
  import type { Editor } from '../app/editor';
  import { guessSlices, type PictureMode, type PictureSettings } from '../app/pictures';
  import Icon from './Icon.svelte';
  import NumberField from './NumberField.svelte';

  /**
   * Pictures and slices (PNG slices, picture import): a picture becomes a
   * plane, a height map or a model from a sheet of slices; a model goes out as slices.
   */
  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const open = $derived(editor.picturesOpen);
  const s = $derived(editor.pictureSettings);
  const activeObject = $derived(editor.activeObject);
  const set = (patch: Partial<PictureSettings>) => editor.pictureSettings.update((v) => ({ ...v, ...patch }));
  const close = () => editor.picturesOpen.set(null);

  let file = $state<File | null>(null);
  let preview = $state('');
  let size = $state<{ width: number; height: number } | null>(null);
  let input = $state<HTMLInputElement>();

  const MODES: { id: PictureMode; title: string; tip: string }[] = [
    { id: 'plane', title: 'Plane', tip: 'A voxel for every opaque pixel' },
    { id: 'heightmap', title: 'Height map', tip: 'The lighter the pixel, the taller the column' },
    { id: 'slices', title: 'Slice sheet', tip: 'Model layers from bottom to top, left to right and down the grid' },
  ];

  async function pick(f: File | undefined) {
    if (!f) return;
    if (preview) URL.revokeObjectURL(preview);
    file = f;
    preview = URL.createObjectURL(f);
    try {
      const bitmap = await createImageBitmap(f);
      size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      const guess = guessSlices(f.name, size.width, size.height);
      set({ sliceWidth: guess.width, sliceDepth: guess.depth });
    } catch {
      size = null;
    }
  }

  const layers = $derived(
    size ? Math.floor(size.width / $s.sliceWidth) * Math.floor(size.height / $s.sliceDepth) : 0,
  );
  const scaled = $derived(size && Math.max(size.width, size.height) > $s.maxSide);
</script>

<svelte:window onkeydown={(e) => $open && e.key === 'Escape' && close()} />

{#if $open}
  <div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Pictures and slices">
      <header>
        <div class="seg" role="tablist" aria-label="What to do">
          <button type="button" role="tab" aria-selected={$open === 'import'} class:on={$open === 'import'} onclick={() => editor.picturesOpen.set('import')}>Picture → voxels</button>
          <button type="button" role="tab" aria-selected={$open === 'slices'} class:on={$open === 'slices'} onclick={() => editor.picturesOpen.set('slices')}>PNG slices</button>
        </div>
        <span class="grow"></span>
        <button type="button" class="btn icon" aria-label="Close" onclick={close}><Icon name="close" /></button>
      </header>
      {#if $open === 'import'}
        <div class="body">
          <div class="pick">
            <button type="button" class="btn file" onclick={() => input?.click()}>
              {#if preview}<img src={preview} alt="" />{/if}
              <span>{file ? file.name : 'Choose a picture…'}</span>
              {#if size}<span class="dim">{size.width}×{size.height}</span>{/if}
            </button>
            <input bind:this={input} type="file" accept="image/*" hidden onchange={(e) => { void pick(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
          </div>
          <div class="seg wide" role="radiogroup" aria-label="How to read the picture">
            {#each MODES as m (m.id)}
              <button type="button" role="radio" aria-checked={$s.mode === m.id} class:on={$s.mode === m.id} onclick={() => set({ mode: m.id })}>{m.title}</button>
            {/each}
          </div>
          <p class="hint">{MODES.find((m) => m.id === $s.mode)?.tip}. Colors are the nearest from the palette, transparent pixels are empty.</p>
          {#if $s.mode === 'plane'}
            <div class="row">
              <span>Orientation</span>
              <span class="seg" role="radiogroup" aria-label="Orientation">
                <button type="button" role="radio" aria-checked={$s.facing === 'upright'} class:on={$s.facing === 'upright'} onclick={() => set({ facing: 'upright' })}>Standing</button>
                <button type="button" role="radio" aria-checked={$s.facing === 'flat'} class:on={$s.facing === 'flat'} onclick={() => set({ facing: 'flat' })}>Lying</button>
              </span>
            </div>
          {:else if $s.mode === 'heightmap'}
            <label class="row">
              <span>Height of white</span>
              <span class="num"><NumberField label="Height of white" value={$s.maxHeight} min={1} max={256} onChange={(v) => set({ maxHeight: v })} /></span>
            </label>
            <label class="check"><input type="checkbox" checked={$s.oneColor} onchange={(e) => set({ oneColor: e.currentTarget.checked })} />In the current color, not the picture's colors</label>
          {:else}
            <div class="row">
              <span>Slice, pixels</span>
              <span class="pair">
                <span class="num"><NumberField label="Slice width" value={$s.sliceWidth} min={1} max={1024} onChange={(v) => set({ sliceWidth: v })} /></span>
                ×
                <span class="num"><NumberField label="Slice depth" value={$s.sliceDepth} min={1} max={1024} onChange={(v) => set({ sliceDepth: v })} /></span>
              </span>
            </div>
            {#if size}<p class="hint">Layers: {layers}. The size comes from the file name if the slice export saved it.</p>{/if}
          {/if}
          {#if $s.mode !== 'slices'}
            <label class="row">
              <span>At most, pixels</span>
              <span class="num"><NumberField label="Longest side" value={$s.maxSide} min={8} max={1024} onChange={(v) => set({ maxSide: v })} /></span>
            </label>
            {#if scaled}<p class="hint">The picture will be shrunk to {$s.maxSide} on its longest side.</p>{/if}
          {/if}
        </div>
        <footer>
          <span class="hint">The new object goes where the camera looks.</span>
          <button type="button" class="btn go" disabled={!file} onclick={() => file && void editor.importPicture(file)}>Create object</button>
        </footer>
      {:else}
        <div class="body">
          <div class="row">
            <span>What</span>
            <span class="seg" role="radiogroup" aria-label="What to slice">
              <button type="button" role="radio" aria-checked={!$s.wholeScene} class:on={!$s.wholeScene} onclick={() => set({ wholeScene: false })}>{$activeObject ? `“${$activeObject.name}”` : 'Object'}</button>
              <button type="button" role="radio" aria-checked={$s.wholeScene} class:on={$s.wholeScene} onclick={() => set({ wholeScene: true })}>Whole scene</button>
            </span>
          </div>
          <div class="row">
            <span>Files</span>
            <span class="seg" role="radiogroup" aria-label="Files">
              <button type="button" role="radio" aria-checked={!$s.separate} class:on={!$s.separate} onclick={() => set({ separate: false })}>One sheet</button>
              <button type="button" role="radio" aria-checked={$s.separate} class:on={$s.separate} onclick={() => set({ separate: true })}>PNG per layer, ZIP</button>
            </span>
          </div>
          <p class="hint">Layers by height from bottom to top; in each, x goes right and z goes down. On the sheet — a grid left to right and down; the file name holds width×depth×layers, so the sheet reads back.</p>
        </div>
        <footer>
          <span class="grow"></span>
          <button type="button" class="btn go" onclick={() => void editor.exportSlices()}>Save slices</button>
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 6vh 12px 12px;
    background: rgb(0 0 0 / 40%);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    width: min(500px, 100%);
    max-height: 86vh;
    border: 1px solid var(--line-strong);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: 0 16px 48px rgb(0 0 0 / 50%);
    overflow: hidden;
  }
  header,
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 10px 10px 16px;
  }
  header {
    border-bottom: 1px solid var(--line);
  }
  footer {
    border-top: 1px solid var(--line);
  }
  .grow {
    flex: 1;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px;
    overflow-y: auto;
  }
  .file {
    width: 100%;
    height: auto;
    min-height: 56px;
    justify-content: flex-start;
    gap: 10px;
    padding: 6px 10px;
    border: 1px dashed var(--line-strong);
    color: var(--text);
  }
  .file img {
    width: 44px;
    height: 44px;
    object-fit: contain;
    image-rendering: pixelated;
    border-radius: 4px;
    background: var(--surface-2);
  }
  .file span:not(.dim) {
    flex: 1;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
  }
  .dim {
    color: var(--text-faint);
    font: 12px var(--mono);
  }
  .wide {
    display: flex;
  }
  .wide > button {
    flex: 1;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 32px;
    color: var(--text-dim);
  }
  .pair {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .num {
    width: 80px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    cursor: pointer;
  }
  .check input {
    accent-color: var(--accent);
  }
  .hint {
    margin: 0;
    color: var(--text-faint);
    font-size: 12px;
  }
  footer .hint {
    flex: 1;
  }
  .go {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
    padding: 0 14px;
  }
  .go:hover:not(:disabled) {
    background: var(--accent);
    color: var(--accent-text);
    filter: brightness(1.08);
  }
</style>
