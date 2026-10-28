<script lang="ts">
  import type { Editor } from '../app/editor';
  import {
    MATERIAL_PARAMS,
    MATERIAL_TITLES,
    type MaterialType,
    materialType,
    materialValue,
    withMaterial,
  } from '../core/materials';
  import { PaletteEntriesCommand } from '../core/palette-edit';
  import NumberField from './NumberField.svelte';

  interface Props {
    editor: Editor;
    /** The palette entry being edited. */
    id: number;
  }
  const { editor, id }: Props = $props();
  const version = $derived(editor.paletteVersion);
  const selection = $derived(editor.paletteSelection);
  /** Like the colour editor: all selected colours when this one is among them. */
  const targets = $derived($selection.length > 1 && $selection.includes(id) ? $selection : [id]);
  const material = $derived.by(() => {
    void $version;
    return editor.doc.palette.entry(id).material;
  });
  const type = $derived(materialType(material));
  const TYPES = Object.keys(MATERIAL_TITLES) as MaterialType[];

  /** Sets material keys on every target (dragging a number is one step). */
  function set(patch: Record<string, string | number>, merge: boolean): void {
    const palette = editor.doc.palette;
    const entries = targets.map((t) => {
      const e = palette.entry(t);
      return { ...e, material: withMaterial(e.material, patch) };
    });
    editor.doc.history.execute(new PaletteEntriesCommand('Material', palette, targets, entries), {
      merge,
    });
  }
</script>

<div class="material">
  <label class="type">
    <span>Material</span>
    <select
      class="select"
      value={type}
      onchange={(e) => {
        set({ _type: e.currentTarget.value }, false);
        editor.doc.history.closeMerge();
      }}
    >
      {#each TYPES as t (t)}<option value={t}>{MATERIAL_TITLES[t]}</option>{/each}
    </select>
  </label>
  {#each MATERIAL_PARAMS[type] as p (p.key)}
    <label class="param">
      <span>{p.title}</span>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={materialValue(material, p)}
        oninput={(e) => set({ [p.key]: Number(e.currentTarget.value) }, true)}
        onchange={() => editor.doc.history.closeMerge()}
      />
      <span class="num">
        <NumberField
          label={p.title}
          value={materialValue(material, p)}
          min={p.min}
          max={p.max}
          step={p.step}
          decimals={p.step < 1 ? 2 : 0}
          reset={p.fallback}
          onChange={(v, live) => set({ [p.key]: v }, live)}
          onEnd={() => editor.doc.history.closeMerge()}
        />
      </span>
    </label>
  {/each}
  <p class="note">
    {type === '_diffuse'
      ? 'Materials show in the render and go to the export as PBR.'
      : 'Settings as in MagicaVoxel: the file keeps them, the render and export use them.'}
  </p>
</div>

<style>
  .material {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 6px 2px;
    border-top: 1px solid var(--line);
  }
  .type,
  .param {
    display: grid;
    grid-template-columns: 96px 1fr 56px;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
    font-size: 12px;
  }
  .type {
    grid-template-columns: 96px 1fr;
  }
  .select {
    height: 26px;
    border: 0;
    border-radius: var(--radius-s);
    background: var(--surface-2);
    color: var(--text);
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  .note {
    margin: 0;
    color: var(--text-faint);
    font-size: 11px;
  }
</style>
