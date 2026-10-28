<script lang="ts">
  import type { Action } from '../app/actions';
  import { searchActions } from '../app/command-search';
  import type { Editor } from '../app/editor';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const open = $derived(editor.commandsOpen);

  let query = $state('');
  let active = $state(0);
  let list = $state<HTMLElement>();

  // Raw: actions are objects with methods; a deep proxy would wrap them for nothing.
  let results = $state.raw<Action[]>([]);
  $effect(() => {
    if (!$open) return;
    results = searchActions(
      editor.actions.all().filter((a) => a.id !== 'app.commands'),
      query,
      (id) => editor.actions.shortcut(id),
      editor.recentActions.get(),
    );
    active = 0;
  });

  function close(): void {
    editor.commandsOpen.set(false);
    query = '';
  }

  function run(action: Action | undefined): void {
    if (!action) return;
    if (!editor.actions.isEnabled(action)) {
      editor.toast(`Not available now: ${action.title}`);
      return;
    }
    close();
    editor.runCommand(action.id);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + results.length) % Math.max(1, results.length);
      list?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[active]);
    }
  }

  function focus(input: HTMLInputElement): void {
    input.focus();
  }
</script>

{#if $open}
  <div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
    <div class="palette" role="dialog" aria-modal="true" aria-label="Commands">
      <input
        use:focus
        bind:value={query}
        onkeydown={onKey}
        placeholder="Command: mirror, rotate, select all…"
        aria-label="Find a command"
        aria-controls="command-list"
        aria-activedescendant={results.length ? `command-${active}` : undefined}
        role="combobox"
        aria-expanded="true"
        spellcheck="false"
        autocomplete="off"
      />
      <ul id="command-list" role="listbox" bind:this={list}>
        {#each results as action, i (action.id)}
          {@const key = editor.actions.shortcut(action.id)}
          {@const enabled = editor.actions.isEnabled(action)}
          <li
            id="command-{i}"
            data-index={i}
            role="option"
            aria-selected={i === active}
            aria-disabled={!enabled}
            class:active={i === active}
            class:disabled={!enabled}
            onpointermove={() => (active = i)}
            onclick={() => run(action)}
            onkeydown={() => {}}
          >
            <span class="check">{action.checked?.() ? '✓' : ''}</span>
            <span class="title">{action.title}</span>
            <span class="group">{action.group}</span>
            {#if key}<kbd>{key}</kbd>{/if}
          </li>
        {/each}
        {#if results.length === 0}
          <li class="empty" role="option" aria-selected="false">Nothing found</li>
        {/if}
      </ul>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 10vh 12px 12px;
    background: rgb(0 0 0 / 35%);
  }
  .palette {
    display: flex;
    flex-direction: column;
    width: min(560px, 100%);
    max-height: 70vh;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--panel);
    box-shadow: 0 16px 48px rgb(0 0 0 / 50%);
    overflow: hidden;
  }
  input {
    height: 48px;
    padding: 0 14px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: none;
    font-size: 16px;
    outline: none;
  }
  ul {
    margin: 0;
    padding: 4px;
    list-style: none;
    overflow-y: auto;
  }
  li {
    display: grid;
    grid-template-columns: 16px 1fr auto auto;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 0 10px 0 6px;
    border-radius: 6px;
    cursor: pointer;
  }
  li.active {
    background: rgb(255 159 67 / 16%);
  }
  li.disabled {
    opacity: 0.45;
  }
  .check {
    color: var(--accent);
    text-align: center;
  }
  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .group {
    color: var(--text-dim);
    font-size: 12px;
  }
  kbd {
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text-dim);
    font: 12px var(--mono);
  }
  .empty {
    display: block;
    padding: 10px;
    color: var(--text-dim);
    cursor: default;
  }
  @media (pointer: coarse) {
    li {
      min-height: 44px;
    }
  }
</style>
