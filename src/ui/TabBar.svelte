<script lang="ts">
  import type { Editor } from '../app/editor';
  import Icon from './Icon.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const tabs = $derived(editor.tabs);
  const active = $derived(editor.activeTab);
  const key = (id: string) => editor.actions.shortcut(id) ?? '';

  /** Dragging a tab sideways puts it in another place. */
  let dragId = $state<number | null>(null);

  function dragStart(e: DragEvent, id: number): void {
    dragId = id;
    e.dataTransfer?.setData('text/plain', String(id));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  function drop(e: DragEvent, index: number): void {
    e.preventDefault();
    if (dragId !== null) editor.moveTab(dragId, index);
    dragId = null;
  }
</script>

<div class="tabs" role="tablist" aria-label="Documents">
  {#each $tabs as tab, i (tab.id)}
    <div
      class="tab"
      class:on={tab.id === $active}
      class:dragging={dragId === tab.id}
      role="presentation"
      draggable="true"
      ondragstart={(e) => dragStart(e, tab.id)}
      ondragover={(e) => e.preventDefault()}
      ondrop={(e) => drop(e, i)}
      ondragend={() => (dragId = null)}
      onauxclick={(e) => {
        if (e.button === 1) editor.closeTab(tab.id);
      }}
    >
      <button
        type="button"
        role="tab"
        class="name"
        aria-selected={tab.id === $active}
        data-tip={tab.modified ? `${tab.name} — has unsaved changes` : tab.name}
        onclick={() => editor.switchTab(tab.id)}
      >
        <span class="text">{tab.name}</span>
        {#if tab.modified}<span class="dot" aria-label="not saved"></span>{/if}
      </button>
      {#if $tabs.length > 1 || tab.modified}
        <button
          type="button"
          class="close"
          aria-label="Close “{tab.name}”"
          data-tip="Close tab"
          data-key={key('file.closeTab')}
          onclick={() => editor.closeTab(tab.id)}
        >
          <Icon name="close" />
        </button>
      {/if}
    </div>
  {/each}
  <button
    type="button"
    class="btn icon add"
    aria-label="New document"
    data-tip="New document"
    data-key={key('file.new')}
    onclick={() => editor.newTab()}
  >
    <Icon name="add" />
  </button>
</div>

<style>
  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    margin-left: 4px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .tab {
    display: flex;
    flex: none;
    align-items: center;
    max-width: 200px;
    height: 30px;
    border-radius: var(--radius-s);
    color: var(--text-dim);
  }
  .tab:hover {
    background: var(--hover);
    color: var(--text);
  }
  .tab.on {
    background: var(--surface-2);
    color: var(--text);
  }
  .tab.dragging {
    opacity: 0.5;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 100%;
    padding: 0 6px 0 10px;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .name:focus-visible,
  .close:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }
  .close {
    display: grid;
    flex: none;
    place-items: center;
    width: 22px;
    height: 22px;
    margin-right: 4px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--text-faint);
    cursor: pointer;
  }
  .close :global(svg) {
    width: 12px;
    height: 12px;
  }
  .close:hover {
    background: var(--hover);
    color: var(--text);
  }
  .add {
    flex: none;
  }
  @media (max-width: 520px) {
    .tab {
      max-width: 120px;
    }
  }
</style>
