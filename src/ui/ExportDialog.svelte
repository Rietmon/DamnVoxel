<script lang="ts">
  import type { Editor } from '../app/editor';
  import { type ExportSettings, fileBase, formatColors, MESH_FORMATS, type MeshFormat } from '../app/export-settings';
  import Icon from './Icon.svelte';
  import NumberField from './NumberField.svelte';

  /** Mesh export (docs/formats.md, “Mesh export”): the format and how the meshes are laid out. */
  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const open = $derived(editor.exportOpen);
  const s = $derived(editor.exportSettings);
  const docName = $derived(editor.docName);
  const set = (patch: Partial<ExportSettings>) => editor.exportSettings.update((v) => ({ ...v, ...patch }));
  const close = () => editor.exportOpen.set(false);

  const FORMATS: Record<MeshFormat, { title: string; tip: string }> = {
    glb: { title: 'GLB', tip: 'glTF in one file: engines, Blender, the web. PBR materials' },
    gltf: { title: 'glTF', tip: 'glTF as text, data inside' },
    obj: { title: 'OBJ', tip: 'OBJ + MTL + PNG palette, as in MagicaVoxel' },
    ply: { title: 'PLY', tip: 'Color in vertices: MeshLab, scans, point clouds' },
    stl: { title: 'STL', tip: 'For 3D printing: shape only' },
  };
  const PIVOTS = [
    { id: 'bottom', title: 'Bottom', tip: 'The origin is the middle of the bottom: the model stands on the floor' },
    { id: 'center', title: 'Center', tip: 'The middle of the model box' },
    { id: 'world', title: 'As in the scene', tip: 'The scene origin' },
  ] as const;

  const colorKind = $derived(formatColors($s.format));
  const isGltf = $derived($s.format === 'glb' || $s.format === 'gltf');
  const example = $derived(
    fileBase(
      $s.separate && !/\{object\}|\{n\}/.test($s.names) ? `${$s.names}-{n}` : $s.names,
      $docName,
      'Object 1',
      1,
    ),
  );
</script>

<svelte:window onkeydown={(e) => $open && e.key === 'Escape' && close()} />

{#if $open}
  <div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Export mesh">
      <header>
        <h2>Export mesh</h2>
        <span class="grow"></span>
        <button type="button" class="btn icon" aria-label="Close" onclick={close}><Icon name="close" /></button>
      </header>
      <div class="body">
        <div class="seg wide" role="radiogroup" aria-label="Format">
          {#each MESH_FORMATS as f (f)}
            <button type="button" role="radio" aria-checked={$s.format === f} class:on={$s.format === f} data-tip={FORMATS[f].tip} onclick={() => set({ format: f })}>{FORMATS[f].title}</button>
          {/each}
        </div>
        <p class="hint">{FORMATS[$s.format].tip}.</p>

        <div class="row">
          <span>Color</span>
          {#if colorKind === 'choice'}
            <span class="seg" role="radiogroup" aria-label="Color">
              <button type="button" role="radio" aria-checked={$s.colors === 'vertex'} class:on={$s.colors === 'vertex'} onclick={() => set({ colors: 'vertex' })}>In vertices</button>
              <button type="button" role="radio" aria-checked={$s.colors === 'texture'} class:on={$s.colors === 'texture'} onclick={() => set({ colors: 'texture' })}>Palette texture</button>
            </span>
          {:else}
            <span class="note">{colorKind === 'vertex' ? 'in vertices' : 'no color'}</span>
          {/if}
        </div>
        <div class="row">
          <span>Origin</span>
          <span class="seg" role="radiogroup" aria-label="Origin">
            {#each PIVOTS as p (p.id)}
              <button type="button" role="radio" aria-checked={$s.pivot === p.id} class:on={$s.pivot === p.id} data-tip={p.tip} onclick={() => set({ pivot: p.id })}>{p.title}</button>
            {/each}
          </span>
        </div>
        <div class="row">
          <span>Up axis</span>
          {#if isGltf}
            <span class="note">Y — glTF requires it</span>
          {:else}
            <span class="seg" role="radiogroup" aria-label="Up axis">
              <button type="button" role="radio" aria-checked={$s.axes === 'y-up'} class:on={$s.axes === 'y-up'} data-tip="Engines, Blender importing with Y up" onclick={() => set({ axes: 'y-up' })}>Y</button>
              <button type="button" role="radio" aria-checked={$s.axes === 'z-up'} class:on={$s.axes === 'z-up'} data-tip="3D printing, CAD, Blender without a turn" onclick={() => set({ axes: 'z-up' })}>Z</button>
            </span>
          {/if}
        </div>
        <label class="row">
          <span>Voxel size</span>
          <span class="num"><NumberField label="Voxel size in file units" value={$s.scale} min={0.001} max={1000} step={0.1} decimals={3} reset={1} onChange={(v) => set({ scale: v })} /></span>
        </label>
        <label class="check"><input type="checkbox" checked={$s.selectedOnly} onchange={(e) => set({ selectedOnly: e.currentTarget.checked })} />Selected only</label>
        <label class="check"><input type="checkbox" checked={$s.separate} onchange={(e) => set({ separate: e.currentTarget.checked })} />One file per object</label>
        <label class="row">
          <span>File name</span>
          <input class="text" type="text" value={$s.names} spellcheck="false" oninput={(e) => set({ names: e.currentTarget.value })} />
        </label>
        <p class="hint">
          <code>{'{doc}'}</code> — document, <code>{'{object}'}</code> — object, <code>{'{n}'}</code> — number. For example: <b>{example}.{$s.format}</b>
          {#if $s.separate || ($s.format === 'obj' && $s.colors === 'texture')} — the files come as one ZIP{/if}
        </p>
      </div>
      <footer>
        <span class="hint">Visible objects as in the scene; faces of one color are merged, no inner faces.</span>
        <button type="button" class="btn go" onclick={() => void editor.files.exportMesh()}>Export</button>
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
    width: min(520px, 100%);
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
  .num {
    width: 96px;
  }
  .note {
    color: var(--text-faint);
  }
  .text {
    flex: 1;
    max-width: 260px;
    height: var(--control);
    padding: 0 8px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-s);
    background: var(--surface-2);
    font: 13px var(--mono);
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
  code {
    font: 12px var(--mono);
    color: var(--text-dim);
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
