<script lang="ts">
  import type { Editor } from '../app/editor';
  import Icon from './Icon.svelte';
  import ModeSwitch from './ModeSwitch.svelte';
  import Popover from './Popover.svelte';
  import TabBar from './TabBar.svelte';

  interface Props {
    editor: Editor;
    /** Narrow window: the View menu lives in a sheet instead. */
    compact?: boolean;
  }
  const { editor, compact = false }: Props = $props();
  const version = $derived(editor.historyVersion);
  const ui = $derived(editor.ui);

  const MENU = [
    'file.new',
    'file.open',
    'file.save',
    'file.saveAs',
    'file.export',
    'file.importMesh',
    'file.importPicture',
    'file.exportSlices',
    'file.versions',
    'file.examples',
    'program.new',
    '-',
    'app.commands',
    'app.keymap',
    'file.help',
    'ui.hide',
  ];
  let menuButton = $state<HTMLElement>();
  let viewButton = $state<HTMLElement>();
  let menuOpen = $state(false);
  let viewOpen = $state(false);

  const can = $derived.by(() => {
    void $version;
    const h = editor.doc.history;
    return { undo: h.canUndo, redo: h.canRedo, undoLabel: h.undoLabel, redoLabel: h.redoLabel };
  });
  const key = (id: string) => editor.actions.shortcut(id) ?? '';
  const title = (id: string) => editor.actions.get(id)?.title ?? id;

  function runItem(id: string): void {
    menuOpen = false;
    editor.actions.run(id);
  }
</script>

<header class="topbar">
  <div class="side left">
    <button
      type="button"
      class="btn icon"
      class:on={menuOpen}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      aria-label="Menu"
      data-tip="File and menu"
      bind:this={menuButton}
      onclick={() => (menuOpen = !menuOpen)}
    >
      <Icon name="menu" />
    </button>
    <TabBar {editor} />
  </div>
  <ModeSwitch {editor} />
  <div class="side right">
    <button
      type="button"
      class="btn icon"
      aria-label="Undo"
      data-tip={can.undoLabel ? `Undo: ${can.undoLabel}` : 'Undo'}
      data-key={key('edit.undo')}
      disabled={!can.undo}
      onclick={() => editor.actions.run('edit.undo')}
    >
      <Icon name="undo" />
    </button>
    <button
      type="button"
      class="btn icon"
      aria-label="Redo"
      data-tip={can.redoLabel ? `Redo: ${can.redoLabel}` : 'Redo'}
      data-key={key('edit.redo')}
      disabled={!can.redo}
      onclick={() => editor.actions.run('edit.redo')}
    >
      <Icon name="redo" />
    </button>
    {#if !compact}
      <span class="sep"></span>
      <button
        type="button"
        class="btn"
        class:on={$ui.timeline}
        aria-pressed={$ui.timeline}
        data-tip="Animation: timeline, frames, keys"
        data-key={key('ui.timeline')}
        onclick={() => editor.actions.run('ui.timeline')}
      >
        <Icon name="film" />Animation
      </button>
      <button
        type="button"
        class="btn"
        class:on={viewOpen}
        aria-haspopup="dialog"
        aria-expanded={viewOpen}
        data-tip="Shading, helpers, light, slice"
        bind:this={viewButton}
        onclick={() => (viewOpen = !viewOpen)}
      >
        <Icon name="eye" />View
      </button>
      <button
        type="button"
        class="btn"
        data-tip={title('app.commands')}
        data-key={key('app.commands')}
        onclick={() => editor.commandsOpen.set(true)}
      >
        <Icon name="command" /><kbd>{key('app.commands')}</kbd>
      </button>
    {/if}
  </div>
</header>

{#if menuOpen && menuButton}
  <Popover anchor={menuButton} label="Menu" onClose={() => (menuOpen = false)}>
    <div class="items" role="menu">
      {#each MENU as id, i (id + i)}
        {#if id === '-'}
          <div class="divider"></div>
        {:else}
          <button type="button" role="menuitem" class="item" onclick={() => runItem(id)}>
            <span>{title(id)}</span>
            {#if key(id)}<kbd>{key(id)}</kbd>{/if}
          </button>
        {/if}
      {/each}
    </div>
  </Popover>
{/if}
{#if viewOpen && viewButton}
  <Popover anchor={viewButton} align="end" label="View" onClose={() => (viewOpen = false)}>
    {#await import('./ViewMenu.svelte') then { default: ViewMenu }}<ViewMenu {editor} />{/await}
  </Popover>
{/if}

<style>
  .topbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    height: 44px;
    padding: 0 8px;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .side {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }
  .right {
    justify-content: flex-end;
  }
  .items {
    display: flex;
    flex-direction: column;
    min-width: 240px;
    padding: 4px;
  }
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-s);
    background: none;
    color: var(--text);
    white-space: nowrap;
    cursor: pointer;
  }
  .item:hover,
  .item:focus-visible {
    background: var(--hover);
    outline: none;
  }
  .divider {
    height: 1px;
    margin: 4px 6px;
    background: var(--line-strong);
  }
  @media (pointer: coarse) {
    .item {
      height: 44px;
    }
  }
</style>
