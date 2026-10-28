<script lang="ts">
  import type { Action } from '../app/actions';
  import type { Editor } from '../app/editor';
  import {
    assignKeys,
    exportKeymap,
    importKeymap,
    KEYMAP_PRESETS,
    KEYMAPS,
    type KeymapSettings,
    resetKeys,
  } from '../app/keymaps';
  import Icon from './Icon.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const open = $derived(editor.keymapOpen);
  const keymap = $derived(editor.keymap);

  let query = $state('');
  /** The action waiting for a key press. */
  let recording = $state<string | null>(null);
  let notice = $state('');
  let fileInput = $state<HTMLInputElement>();

  const actions = $derived(editor.actions);
  const groups = $derived.by(() => {
    void $keymap;
    const q = query.trim().toLowerCase();
    // Keys are read here, inside the derivation, so every row follows the layout.
    const out = new Map<string, { action: Action; combos: readonly string[] }[]>();
    for (const a of actions.all()) {
      const keys = actions.combos(a.id).map((c) => actions.formatCombo(c).toLowerCase());
      if (q && !a.title.toLowerCase().includes(q) && !keys.some((k) => k.includes(q))) continue;
      const list = out.get(a.group) ?? [];
      list.push({ action: a, combos: actions.combos(a.id) });
      out.set(a.group, list);
    }
    return [...out];
  });

  const title = (id: string) => actions.get(id)?.title ?? id;

  function setKeys(id: string, keys: readonly string[]): void {
    const before = editor.keymap.get();
    const taken = keys
      .map((c) => actions.hotkeys.lookup(c))
      .filter((holder): holder is string => !!holder && holder !== id);
    const next = assignKeys(
      before,
      id,
      keys,
      (a) => actions.combos(a),
      (c) => actions.hotkeys.lookup(c),
    );
    editor.keymap.set(next);
    notice = taken.length ? `Taken from “${taken.map(title).join('”, “')}”` : '';
  }

  function update(fn: (k: KeymapSettings) => KeymapSettings): void {
    editor.keymap.set(fn(editor.keymap.get()));
    notice = '';
  }

  function close(): void {
    editor.keymapOpen.set(false);
    recording = null;
    notice = '';
    query = '';
  }

  // While recording, the next key press is the new shortcut, not a command.
  $effect(() => {
    if (!$open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!recording) {
        if (e.key === 'Escape') {
          e.stopImmediatePropagation();
          close();
        }
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') {
        recording = null;
        return;
      }
      const combo = actions.comboOf(e);
      if (!combo) return;
      const id = recording;
      recording = null;
      const current = actions.combos(id);
      if (!current.includes(combo)) setKeys(id, [...current, combo]);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  function save(): void {
    const url = URL.createObjectURL(
      new Blob([exportKeymap(editor.keymap.get())], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'damnvoxel-keymap.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function load(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      editor.keymap.set(importKeymap(await file.text()));
      notice = `Layout loaded: ${file.name}`;
    } catch (err) {
      notice = (err as Error).message;
    }
  }
</script>

{#if $open}
  <div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Keys and mouse">
      <header>
        <h2>Keys and mouse</h2>
        <button type="button" class="btn icon" aria-label="Close" onclick={close}><Icon name="close" /></button>
      </header>
      <section class="preset">
        <div class="seg" role="radiogroup" aria-label="Layout">
          {#each KEYMAP_PRESETS as p (p)}
            <button
              type="button"
              role="radio"
              aria-checked={$keymap.preset === p}
              class:on={$keymap.preset === p}
              onclick={() => update((k) => ({ ...k, preset: p }))}>{KEYMAPS[p].title}</button
            >
          {/each}
        </div>
        <p class="note">{KEYMAPS[$keymap.preset].mouseNote}. Space or Z with the left button — pan and zoom everywhere.</p>
      </section>
      <input class="search" type="search" bind:value={query} placeholder="Find an action or a key" aria-label="Find" />
      {#if notice}<p class="notice" role="status">{notice}</p>{/if}
      <div class="list">
        {#each groups as [group, list] (group)}
          <h3>{group}</h3>
          {#each list as { action, combos } (action.id)}
            {@const own = action.id in $keymap.overrides}
            <div class="row">
              <span class="title" class:own>{action.title}</span>
              <span class="keys">
                {#each combos as combo (combo)}
                  <span class="chip">
                    <kbd>{actions.formatCombo(combo)}</kbd>
                    <button
                      type="button"
                      aria-label="Remove {actions.formatCombo(combo)}"
                      onclick={() =>
                        setKeys(
                          action.id,
                          combos.filter((c) => c !== combo),
                        )}>×</button
                    >
                  </span>
                {/each}
                {#if recording === action.id}
                  <span class="wait">Press a combination… Esc — cancel</span>
                {:else}
                  <button
                    type="button"
                    class="btn icon add"
                    aria-label="Add a key"
                    data-tip="Add a key"
                    onclick={() => (recording = action.id)}>+</button
                  >
                {/if}
                {#if own}
                  <button
                    type="button"
                    class="btn icon"
                    aria-label="As in the layout"
                    data-tip="Reset to the layout"
                    onclick={() => update((k) => resetKeys(k, action.id))}>↺</button
                  >
                {/if}
              </span>
            </div>
          {/each}
        {/each}
      </div>
      <footer>
        <button type="button" class="btn" onclick={save}>Save to file</button>
        <button type="button" class="btn" onclick={() => fileInput?.click()}>Load from file</button>
        <input
          bind:this={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onchange={(e) => {
            void load(e.currentTarget.files?.[0]);
            e.currentTarget.value = '';
          }}
        />
        <span class="spacer"></span>
        <button
          type="button"
          class="btn"
          disabled={Object.keys($keymap.overrides).length === 0}
          onclick={() => update((k) => ({ ...k, overrides: {} }))}>Reset my keys</button
        >
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
    width: min(680px, 100%);
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
    gap: 6px;
    padding: 8px 8px 8px 16px;
  }
  footer {
    flex-wrap: wrap;
    padding: 10px 12px;
    border-top: 1px solid var(--line);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .preset {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0 16px 10px;
  }
  .preset .seg > button {
    flex: 1;
  }
  .note,
  .notice {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
  }
  .notice {
    padding: 0 16px 8px;
    color: var(--accent);
  }
  .search {
    height: 36px;
    margin: 0 16px 10px;
    padding: 0 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-s);
    background: var(--bg);
    color: var(--text);
  }
  .list {
    flex: 1;
    min-height: 0;
    padding: 0 8px 8px;
    overflow-y: auto;
  }
  h3 {
    margin: 10px 8px 4px;
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 500;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 2px 8px;
    border-radius: var(--radius-s);
  }
  .row:hover {
    background: var(--hover);
  }
  .title {
    flex: 1;
    min-width: 0;
  }
  .title.own::after {
    content: ' •';
    color: var(--accent);
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-s);
    background: var(--surface-2);
  }
  .chip kbd {
    border: 0;
    background: none;
  }
  .chip button {
    width: 20px;
    height: 22px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-faint);
    cursor: pointer;
  }
  .chip button:hover {
    color: var(--text);
  }
  .add {
    width: 26px;
    height: 26px;
    font-size: 16px;
  }
  .wait {
    color: var(--accent);
    font-size: 12px;
  }
  .spacer {
    flex: 1;
  }
  @media (pointer: coarse) {
    .row {
      min-height: 44px;
    }
  }
</style>
