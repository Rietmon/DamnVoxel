<script lang="ts">
  import type { Editor } from '../app/editor';
  import Icon from './Icon.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const sets = $derived(editor.selectionSets);
  const active = $derived(editor.activeObject);
  const mine = $derived($sets.filter((s) => s.objectId === $active?.id));
</script>

<div class="sets">
  {#each mine as s (s.id)}
    <div class="row">
      <input
        class="name"
        aria-label="Set name"
        value={s.name}
        onchange={(e) => editor.renameSelectionSet(s.id, e.currentTarget.value.trim() || s.name)}
      />
      <button
        type="button"
        class="btn"
        data-tip="Select this set (with Shift — add to the selection)"
        onclick={(e) => editor.restoreSelectionSet(s.id, e.shiftKey ? 'add' : 'replace')}>Select</button
      >
      <button
        type="button"
        class="btn icon"
        aria-label="Forget set"
        data-tip="Forget set"
        onclick={() => editor.removeSelectionSet(s.id)}><Icon name="close" /></button
      >
    </div>
  {:else}
    <p class="note">No sets yet. “Remember” saves the current selection under a name.</p>
  {/each}
  <button type="button" class="btn" onclick={() => editor.saveSelectionSet()}>
    <Icon name="add" />Remember selection
  </button>
</div>

<style>
  .sets {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 300px;
    padding: 10px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .name {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: var(--radius-s);
    background: var(--surface-2);
    color: var(--text);
  }
  .name:focus {
    border-color: var(--accent);
    outline: none;
  }
  .note {
    margin: 0;
    color: var(--text-faint);
    font-size: 12px;
  }
</style>
