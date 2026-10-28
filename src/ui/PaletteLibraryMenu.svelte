<script lang="ts">
  import type { Editor } from '../app/editor';
  import {
    PaletteLibrary,
    PRESETS,
    paletteFile,
    palettePng,
    readPaletteFile,
  } from '../app/palette-library';
  import { toHex } from '../core/color';
  import { applyColors } from '../core/palette-edit';
  import type { NamedColors } from '../app/palette-library';
  import Icon from './Icon.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const library = new PaletteLibrary();
  const saved = $derived(library.saved);
  let fileInput = $state<HTMLInputElement>();
  let saveName = $state('');
  let notice = $state('');

  function apply(p: NamedColors, mode: 'replace' | 'remap'): void {
    applyColors(editor.doc, p.colors, mode);
    notice =
      mode === 'remap'
        ? `“${p.name}”: the model is fitted to the new colors`
        : `“${p.name}”: colors replaced, the model is recolored`;
  }

  function current(name: string): NamedColors {
    const p = editor.doc.palette;
    return { name, colors: p.displayOrder().map((id) => p.color(id)) };
  }

  function download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportAs(format: 'gpl' | 'hex' | 'pal' | 'act' | 'png'): Promise<void> {
    const name = editor.docName.get() || 'palette';
    const p = current(name);
    const blob = format === 'png' ? await palettePng(p) : paletteFile(p, format);
    if (blob) download(blob, `${name}.${format}`);
  }

  async function importFile(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const p = await readPaletteFile(file);
      if (p.colors.length === 0) throw new Error('The file has no colors');
      library.save(p);
      notice = `“${p.name}”: ${p.colors.length} colors in the library — apply it below`;
    } catch (e) {
      notice = (e as Error).message;
    }
  }
</script>

{#snippet row(p: NamedColors, removable: boolean)}
  <div class="row">
    <div class="head">
      <span class="name">{p.name}</span>
      <span class="count">{p.colors.length}</span>
      {#if removable}
        <button type="button" class="btn icon" aria-label="Delete palette" onclick={() => library.remove(p.name)}
          ><Icon name="close" /></button
        >
      {/if}
    </div>
    <div class="strip">
      {#each p.colors.slice(0, 64) as c, i (i)}<span style:background={toHex(c)}></span>{/each}
    </div>
    <div class="actions">
      <button type="button" class="btn" data-tip="Colors 1…N become these; voxels are recolored" onclick={() => apply(p, 'replace')}
        >Replace</button
      >
      <button
        type="button"
        class="btn"
        data-tip="Every voxel takes the nearest of the new colors: the model looks as before, as far as possible"
        onclick={() => apply(p, 'remap')}>Fit the model</button
      >
    </div>
  </div>
{/snippet}

<div class="menu">
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  <h3>Built-in</h3>
  {#each PRESETS as p (p.name)}{@render row(p, false)}{/each}
  {#if $saved.length > 0}
    <h3>Mine</h3>
    {#each $saved as p (p.name)}{@render row(p, true)}{/each}
  {/if}
  <h3>Save and share</h3>
  <div class="line">
    <input class="field" placeholder="Palette name" bind:value={saveName} />
    <button
      type="button"
      class="btn"
      disabled={!saveName.trim()}
      onclick={() => {
        library.save(current(saveName.trim()));
        notice = `Saved: “${saveName.trim()}”`;
        saveName = '';
      }}>Save current</button
    >
  </div>
  <div class="line">
    <button type="button" class="btn" onclick={() => fileInput?.click()}>Import…</button>
    <span class="label">Export:</span>
    {#each ['gpl', 'hex', 'pal', 'act', 'png'] as const as f (f)}
      <button type="button" class="btn" onclick={() => exportAs(f)}>.{f}</button>
    {/each}
  </div>
  <input
    bind:this={fileInput}
    type="file"
    accept=".gpl,.hex,.txt,.pal,.act,.png,.vox"
    hidden
    onchange={(e) => {
      void importFile(e.currentTarget.files?.[0]);
      e.currentTarget.value = '';
    }}
  />
</div>

<style>
  .menu {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 340px;
    padding: 10px 12px 12px;
  }
  h3 {
    margin: 6px 0 0;
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 500;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .name {
    flex: 1;
    font-weight: 600;
  }
  .count {
    color: var(--text-faint);
    font: 11px var(--mono);
  }
  .strip {
    display: flex;
    height: 12px;
    overflow: hidden;
    border-radius: 3px;
  }
  .strip span {
    flex: 1;
  }
  .actions,
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  .field {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-s);
    background: var(--bg);
    color: var(--text);
  }
  .notice {
    margin: 0;
    color: var(--accent);
    font-size: 12px;
  }
</style>
