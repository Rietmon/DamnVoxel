<script lang="ts">
  import { drawThumbnail } from '../app/assets';
  import type { Editor } from '../app/editor';
  import type { Example } from '../app/examples';
  import { worldVolume } from '../app/pictures';
  import Icon from './Icon.svelte';

  /** Example scenes (the guide's front page, “Examples”): each opens in a tab of its own. */
  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const open = $derived(editor.examplesOpen);
  const close = () => editor.examplesOpen.set(false);

  /** The examples and their pictures, loaded and drawn when the window first opens. */
  let examples = $state<readonly Example[]>([]);
  let thumbs = $state<Record<string, string>>({});
  $effect(() => {
    if (!$open || examples.length > 0) return;
    void import('../app/examples').then(({ EXAMPLES }) => {
      examples = EXAMPLES;
      thumbs = drawThumbs(EXAMPLES);
    });
  });

  function drawThumbs(list: readonly Example[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of list) {
      const doc = e.build();
      const colors = new Map<number, number>();
      for (let id = 1; id <= doc.palette.size; id++) colors.set(id, doc.palette.color(id));
      out[e.id] = drawThumbnail({ volume: worldVolume(doc.scene.objects()), colors }, 160);
    }
    return out;
  }

  function choose(e: Example) {
    editor.openExample(e);
    close();
  }
</script>

<svelte:window onkeydown={(e) => $open && e.key === 'Escape' && close()} />

{#if $open}
  <div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Examples">
      <header>
        <h2>Examples</h2>
        <span class="grow"></span>
        <button type="button" class="btn icon" aria-label="Close" onclick={close}><Icon name="close" /></button>
      </header>
      <div class="grid">
        {#each examples as e (e.id)}
          <button type="button" class="card" onclick={() => choose(e)}>
            {#if thumbs[e.id]}<img src={thumbs[e.id]} alt="" />{:else}<span class="noimg"></span>{/if}
            <span class="title">{e.title}</span>
            <span class="text">{e.description}</span>
          </button>
        {/each}
      </div>
      <p class="foot">An example opens in a new tab; your documents do not change.</p>
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
    width: min(720px, 100%);
    max-height: 86vh;
    border: 1px solid var(--line-strong);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: 0 16px 48px rgb(0 0 0 / 50%);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 10px 10px 16px;
    border-bottom: 1px solid var(--line);
  }
  h2 {
    margin: 0;
    font-size: 15px;
  }
  .grow {
    flex: 1;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px;
    padding: 12px;
    overflow-y: auto;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .card:hover {
    border-color: var(--accent);
  }
  .card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  img,
  .noimg {
    align-self: center;
    width: 160px;
    height: 160px;
  }
  .title {
    font-weight: 600;
  }
  .text {
    color: var(--text-faint);
    font-size: 12px;
  }
  .foot {
    margin: 0;
    padding: 10px 16px;
    border-top: 1px solid var(--line);
    color: var(--text-faint);
    font-size: 12px;
  }
</style>
