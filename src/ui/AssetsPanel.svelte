<script lang="ts">
  import type { Editor } from '../app/editor';
  import Icon from './Icon.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const assets = $derived(editor.assets.assets);
</script>

<div class="library">
  <button type="button" class="btn save" onclick={() => editor.saveAsset()}>
    <Icon name="add" />Save selection
  </button>
  {#if !editor.assets.available}
    <p class="note">The browser gives no storage: the library will not be saved.</p>
  {/if}
  <div class="grid">
    {#each $assets as a (a.id)}
      <figure class="asset">
        <button
          type="button"
          class="thumb"
          data-tip="Insert as an object · {a.voxels.toLocaleString('en-US')} voxels"
          onclick={() => editor.insertAsset(a)}
        >
          <img src={a.thumb} alt="" />
        </button>
        <input
          class="name"
          aria-label="Asset name"
          value={a.name}
          onchange={(e) => editor.assets.rename(a.id, e.currentTarget.value.trim() || a.name)}
        />
        <div class="actions">
          <button type="button" class="btn" data-tip="Use as a stamp" onclick={() => editor.assetAsStamp(a)}
            >Stamp</button
          >
          <button
            type="button"
            class="btn icon"
            aria-label="Remove from library"
            data-tip="Remove from library"
            onclick={() => editor.assets.remove(a.id)}><Icon name="close" /></button
          >
        </div>
      </figure>
    {:else}
      <p class="note">
        Save an object or a selection — it will appear here and be available in any document.
      </p>
    {/each}
  </div>
</div>

<style>
  .library {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 10px 12px;
  }
  .save {
    align-self: flex-start;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: 8px;
  }
  .asset {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 6px;
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  .thumb {
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-s);
    background: var(--bg);
    cursor: pointer;
  }
  .thumb:hover {
    border-color: var(--accent);
  }
  img {
    display: block;
    width: 100%;
    aspect-ratio: 1;
  }
  .name {
    min-width: 0;
    height: 24px;
    padding: 0 4px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    color: var(--text);
    font-size: 12px;
  }
  .name:focus {
    border-color: var(--accent);
    outline: none;
  }
  .actions {
    display: flex;
    justify-content: space-between;
  }
  .note {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--text-faint);
    font-size: 12px;
  }
</style>
