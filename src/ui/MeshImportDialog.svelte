<script lang="ts">
  import type { Editor } from '../app/editor';
  import { MAX_VOXELIZE_SIZE, type MeshImportSettings } from '../app/mesh-import-settings';
  import Icon from './Icon.svelte';
  import NumberField from './NumberField.svelte';

  /**
   * Voxelizing a mesh (docs/formats.md, “Voxelization”): the model file with what it needs
   * (.bin, .mtl, textures), how many voxels across, solid or a shell, and where it goes.
   */
  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const files = $derived(editor.meshImportFiles);
  const s = $derived(editor.meshImportSettings);
  const set = (patch: Partial<MeshImportSettings>) => editor.meshImportSettings.update((v) => ({ ...v, ...patch }));
  const close = () => editor.meshImportFiles.set(null);
  let input = $state<HTMLInputElement>();
  let busy = $state(false);

  const main = $derived($files?.find((f) => /\.(glb|gltf|obj|stl)$/i.test(f.name)) ?? null);
  const others = $derived($files?.filter((f) => f !== main) ?? []);
  const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

  async function run() {
    if (!$files || !main) return;
    busy = true;
    try {
      await editor.importMesh($files);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => $files && e.key === 'Escape' && close()} />

{#if $files}
  <div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Voxelize mesh">
      <header>
        <h2>Voxelize mesh</h2>
        <span class="grow"></span>
        <button type="button" class="btn icon" aria-label="Close" onclick={close}><Icon name="close" /></button>
      </header>
      <div class="body">
        <button type="button" class="btn file" onclick={() => input?.click()}>
          {#if main}
            <span class="name">{main.name}</span><span class="dim">{kb(main.size)}</span>
          {:else}
            <span class="name">Choose a model: .glb, .gltf, .obj, .stl…</span>
          {/if}
        </button>
        {#if others.length > 0}
          <p class="hint">Together with it: {others.map((f) => f.name).join(', ')}</p>
        {/if}
        <p class="hint">For .gltf and .obj choose their files too — .bin, .mtl, textures. You can also just drop the model into the window.</p>
        <input
          bind:this={input}
          type="file"
          multiple
          accept=".glb,.gltf,.obj,.mtl,.stl,.bin,image/*"
          hidden
          onchange={(e) => {
            editor.meshImportFiles.set([...(e.currentTarget.files ?? [])]);
            e.currentTarget.value = '';
          }}
        />
        <label class="row">
          <span>Voxels along the long side</span>
          <span class="num"><NumberField label="Voxels along the long side" value={$s.size} min={4} max={MAX_VOXELIZE_SIZE} onChange={(v) => set({ size: v })} /></span>
        </label>
        <label class="check"><input type="checkbox" checked={$s.solid} onchange={(e) => set({ solid: e.currentTarget.checked })} />Solid: fill inside closed shapes</label>
        <div class="row">
          <span>Up axis in the file</span>
          <span class="seg" role="radiogroup" aria-label="Up axis">
            <button type="button" role="radio" aria-checked={$s.up === 'auto'} class:on={$s.up === 'auto'} data-tip="Z for STL, Y for the rest" onclick={() => set({ up: 'auto' })}>Auto</button>
            <button type="button" role="radio" aria-checked={$s.up === 'y'} class:on={$s.up === 'y'} onclick={() => set({ up: 'y' })}>Y</button>
            <button type="button" role="radio" aria-checked={$s.up === 'z'} class:on={$s.up === 'z'} onclick={() => set({ up: 'z' })}>Z</button>
          </span>
        </div>
        <div class="row">
          <span>Where</span>
          <span class="seg" role="radiogroup" aria-label="Where">
            <button type="button" role="radio" aria-checked={$s.target === 'new'} class:on={$s.target === 'new'} data-tip="The palette comes from the model's colors" onclick={() => set({ target: 'new' })}>New document</button>
            <button type="button" role="radio" aria-checked={$s.target === 'scene'} class:on={$s.target === 'scene'} data-tip="Colors are the nearest from the document palette" onclick={() => set({ target: 'scene' })}>Into this scene</button>
          </span>
        </div>
      </div>
      <footer>
        <span class="hint">Color comes from the material, vertex colors and the texture at every point.</span>
        <button type="button" class="btn go" disabled={!main || busy} onclick={() => void run()}>{busy ? 'Working…' : 'Voxelize'}</button>
      </footer>
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
  h2 {
    margin: 0;
    font-size: 15px;
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
    min-height: 48px;
    justify-content: flex-start;
    gap: 10px;
    padding: 6px 12px;
    border: 1px dashed var(--line-strong);
    color: var(--text);
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
  }
  .dim {
    color: var(--text-faint);
    font: 12px var(--mono);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 32px;
    color: var(--text-dim);
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
