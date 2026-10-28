<script lang="ts">
  import type { Editor } from '../app/editor';
  import type { Layer } from '../core/scene';
  import Icon from './Icon.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const sceneVersion = $derived(editor.sceneVersion);
  const active = $derived(editor.activeLayer);
  const layers = $derived.by(() => {
    void $sceneVersion;
    return [...editor.doc.scene.layers];
  });
  /** How many objects each layer holds. */
  const counts = $derived.by(() => {
    void $sceneVersion;
    const out = new Map<Layer, number>();
    for (const o of editor.doc.scene.objects()) out.set(o.layer, (out.get(o.layer) ?? 0) + 1);
    return out;
  });
</script>

<div class="layers">
  {#each layers as layer (layer.id)}
    <div class="row" class:active={$active === layer.id} class:hidden={layer.hidden}>
      <input
        type="radio"
        name="active-layer"
        aria-label="New objects go on “{layer.name}”"
        data-tip="New objects appear on this layer"
        checked={$active === layer.id}
        onchange={() => editor.activeLayer.set(layer.id)}
      />
      <input
        class="name"
        aria-label="Layer name"
        value={layer.name}
        onchange={(e) => editor.setLayerProperty(layer, 'name', e.currentTarget.value.trim() || layer.name)}
      />
      <span class="count" data-tip="Objects on the layer">{counts.get(layer) ?? 0}</span>
      <button
        type="button"
        class="btn icon"
        data-tip="Put the selected objects on this layer"
        aria-label="Selected to this layer"
        onclick={() => editor.moveToLayer(layer)}>⤓</button
      >
      <button
        type="button"
        class="btn icon"
        class:on={layer.hidden}
        aria-pressed={layer.hidden}
        aria-label={layer.hidden ? 'Show layer' : 'Hide layer'}
        data-tip={layer.hidden ? 'Show layer' : 'Hide layer'}
        onclick={() => editor.setLayerProperty(layer, 'hidden', !layer.hidden)}><Icon name="eye" /></button
      >
      <button
        type="button"
        class="btn icon"
        class:on={layer.locked}
        aria-pressed={layer.locked}
        aria-label={layer.locked ? 'Unlock layer' : 'Lock layer'}
        data-tip={layer.locked ? 'Locked: objects cannot be edited' : 'Lock: objects cannot be edited'}
        onclick={() => editor.setLayerProperty(layer, 'locked', !layer.locked)}>{layer.locked ? '🔒' : '🔓'}</button
      >
      <button
        type="button"
        class="btn icon"
        aria-label="Delete layer"
        data-tip="Delete layer: objects move to the first one"
        disabled={layers.length === 1}
        onclick={() => editor.removeLayer(layer)}><Icon name="close" /></button
      >
    </div>
  {/each}
  <button type="button" class="btn add" onclick={() => editor.addLayer()}>
    <Icon name="add" />Layer
  </button>
</div>

<style>
  .layers {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 8px 10px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 30px;
    padding: 0 2px 0 4px;
    border-radius: var(--radius-s);
  }
  .row:hover {
    background: var(--hover);
  }
  .row.active {
    background: var(--accent-soft);
  }
  .row.hidden .name {
    color: var(--text-faint);
  }
  input[type='radio'] {
    margin: 0 4px 0 0;
    accent-color: var(--accent);
  }
  .name {
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-s);
    background: none;
    color: var(--text);
  }
  .name:focus {
    border-color: var(--accent);
    background: var(--bg);
    outline: none;
  }
  .count {
    min-width: 2ch;
    color: var(--text-faint);
    font: 11px var(--mono);
    text-align: right;
  }
  .add {
    align-self: flex-start;
    margin-top: 4px;
  }
</style>
