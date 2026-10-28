<script lang="ts">
  import type { Editor } from '../app/editor';
  import type { VersionInfo, VersionReason } from '../app/versions';
  import Icon from './Icon.svelte';

  /**
   * The version history: pictures of the document at each
   * save, every ten minutes of editing and on request. A version opens in a tab of its own.
   */
  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const open = $derived(editor.versionsOpen);
  const versions = $derived(editor.versions.versions);
  const docName = $derived(editor.docName);
  let scope = $state<'doc' | 'all'>('doc');

  const REASONS: Record<VersionReason, string> = {
    save: 'save',
    auto: 'auto',
    manual: 'manual',
  };

  const shown = $derived(scope === 'all' ? $versions : $versions.filter((v) => v.name === $docName));

  /** Versions by day, newest first. */
  const days = $derived.by(() => {
    const out: { day: string; list: VersionInfo[] }[] = [];
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 864e5).toDateString();
    for (const v of shown) {
      const d = new Date(v.savedAt);
      const key = d.toDateString();
      const day =
        key === today
          ? 'Today'
          : key === yesterday
            ? 'Yesterday'
            : d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
      const last = out.at(-1);
      if (last?.day === day) last.list.push(v);
      else out.push({ day, list: [v] });
    }
    return out;
  });

  const time = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
  const close = () => editor.versionsOpen.set(false);
</script>

<svelte:window onkeydown={(e) => $open && e.key === 'Escape' && close()} />

{#if $open}
  <div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Version history">
      <header>
        <h2>Version history</h2>
        <div class="seg" role="radiogroup" aria-label="Whose versions">
          <button type="button" role="radio" aria-checked={scope === 'doc'} class:on={scope === 'doc'} onclick={() => (scope = 'doc')}>«{$docName}»</button>
          <button type="button" role="radio" aria-checked={scope === 'all'} class:on={scope === 'all'} onclick={() => (scope = 'all')}>All</button>
        </div>
        <span class="grow"></span>
        <button type="button" class="btn" disabled={!editor.versions.available} onclick={() => void editor.rememberVersion('manual')}>Remember now</button>
        <button type="button" class="btn icon" aria-label="Close" onclick={close}><Icon name="close" /></button>
      </header>
      <div class="list">
        {#if !editor.versions.available}
          <p class="empty">The browser gives no storage: versions are not saved.</p>
        {:else if shown.length === 0}
          <p class="empty">No versions yet. They appear on every save, every 10 minutes of work and with the “Remember now” button.</p>
        {/if}
        {#each days as d (d.day)}
          <h3>{d.day}</h3>
          {#each d.list as v (v.id)}
            <div class="row">
              {#if v.thumb}<img src={v.thumb} alt="" />{:else}<span class="noimg"></span>{/if}
              <div class="text">
                <span class="when">{time(v.savedAt)} <span class="reason {v.reason}">{REASONS[v.reason]}</span></span>
                <span class="meta">
                  {scope === 'all' ? `${v.name} · ` : ''}{v.voxels.toLocaleString('en-US')} voxels · {size(v.size)}
                </span>
              </div>
              <button type="button" class="btn" onclick={() => void editor.openVersion(v)}>Open</button>
              <button type="button" class="btn icon" aria-label="Delete version" data-tip="Delete version" onclick={() => void editor.versions.remove([v.id])}>
                <Icon name="close" />
              </button>
            </div>
          {/each}
        {/each}
      </div>
      <p class="foot">
        Versions live in this browser, apart from files. A version opens in a new tab — the current document does not change. Old ones go when a document has more than 40 or all of them take more than 256 MB; automatic ones go first.
      </p>
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
    width: min(620px, 100%);
    max-height: 86vh;
    border: 1px solid var(--line-strong);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: 0 16px 48px rgb(0 0 0 / 50%);
    overflow: hidden;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px 10px 10px 16px;
    border-bottom: 1px solid var(--line);
  }
  h2 {
    margin: 0;
    font-size: 15px;
  }
  .seg > button {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grow {
    flex: 1;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 8px 8px;
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
    gap: 10px;
    padding: 4px 8px;
    border-radius: var(--radius-s);
  }
  .row:hover {
    background: var(--hover);
  }
  img,
  .noimg {
    flex: none;
    width: 96px;
    height: 60px;
    border-radius: 6px;
    object-fit: cover;
    background: var(--surface-2);
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }
  .when {
    font-weight: 600;
  }
  .reason {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 500;
  }
  .reason.save {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .meta {
    overflow: hidden;
    color: var(--text-faint);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty,
  .foot {
    margin: 0;
    padding: 12px 16px;
    color: var(--text-faint);
    font-size: 12px;
  }
  .foot {
    border-top: 1px solid var(--line);
  }
</style>
