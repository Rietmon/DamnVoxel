<script lang="ts">
  import type { Editor } from '../app/editor';
  import { ROPE_TITLES, type RopeKind, ropeSpecs } from '../app/ropes';
  import NumberField from './NumberField.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const active = $derived(editor.activeObject);
  const lastRope = $derived(editor.lastRope);
  const sceneVersion = $derived(editor.sceneVersion);
  /** The edited object when it is a rope, else the rope just made (while it is in the scene). */
  const target = $derived.by(() => {
    void $sceneVersion;
    if ($active && ropeSpecs.has($active)) return $active;
    return $lastRope?.parent ? $lastRope : null;
  });
  const spec = $derived.by(() => {
    void $sceneVersion;
    return target ? (ropeSpecs.get(target) ?? null) : null;
  });
  const KINDS = Object.keys(ROPE_TITLES) as RopeKind[];
  const update = (patch: Parameters<typeof editor.updateRope>[1]) => {
    if (target) void editor.updateRope(target, patch);
  };
</script>

{#if spec && target}
  <section class="rope float" aria-label="Rope settings">
    <header>
      <h3>{ROPE_TITLES[spec.kind]}: settings</h3>
      {#if target !== $active}
        <button type="button" class="btn icon" aria-label="Hide" onclick={() => editor.lastRope.set(null)}>×</button>
      {/if}
    </header>
    <div class="seg wide" role="radiogroup" aria-label="Kind">
      {#each KINDS as k (k)}
        <button
          type="button"
          role="radio"
          aria-checked={spec.kind === k}
          class:on={spec.kind === k}
          onclick={() => update({ kind: k })}>{ROPE_TITLES[k]}</button
        >
      {/each}
    </div>
    <div class="fields">
      <label class="field">
        <span>Sag</span>
        <NumberField
          label="Sag: length to distance"
          value={spec.slack}
          min={1}
          max={3}
          step={0.05}
          decimals={2}
          onChange={(v) => update({ slack: v })}
          onEnd={() => editor.doc.history.closeMerge()}
        />
      </label>
      <label class="field">
        <span>Thickness</span>
        <NumberField
          label="Thickness"
          value={spec.thickness}
          min={1}
          max={16}
          onChange={(v) => update({ thickness: v })}
          onEnd={() => editor.doc.history.closeMerge()}
        />
      </label>
      <label class="field">
        <span>Color</span>
        <NumberField label="Color" value={spec.color} min={1} max={255} onChange={(v) => update({ color: v })} />
      </label>
      {#if spec.kind === 'rope'}
        <label class="field">
          <span>Second</span>
          <NumberField
            label="Second color"
            value={spec.color2}
            min={1}
            max={255}
            onChange={(v) => update({ color2: v })}
          />
        </label>
      {/if}
    </div>
  </section>
{/if}

<style>
  .rope {
    position: absolute;
    right: 12px;
    bottom: 12px;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 260px;
    padding: 8px 10px 10px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h3 {
    margin: 0;
    font-size: 13px;
  }
  .wide {
    display: flex;
  }
  .wide > button {
    flex: 1;
  }
  .fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 6px;
  }
  .field {
    display: grid;
    gap: 2px;
    color: var(--text-dim);
    font-size: 11px;
  }
</style>
