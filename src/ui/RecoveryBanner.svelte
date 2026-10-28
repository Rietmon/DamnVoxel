<script lang="ts">
  import { recovery } from '../app/session';

  const time = (ms: number) =>
    new Date(ms).toLocaleString('en-US', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
</script>

{#if $recovery}
  <div class="banner" role="alertdialog" aria-labelledby="recovery-text">
    <p id="recovery-text">
      There is unsaved work “{$recovery.entry.documents.map((d) => d.name).join('”, “')}” from
      {time($recovery.entry.savedAt)}. Restore it?
    </p>
    <div class="buttons">
      <button type="button" class="primary" onclick={() => $recovery?.restore()}>Restore</button>
      <button type="button" onclick={() => $recovery?.discard()}>Discard</button>
    </div>
  </div>
{/if}

<style>
  .banner {
    position: fixed;
    top: 56px;
    left: 50%;
    z-index: 15;
    translate: -50% 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    width: min(560px, calc(100% - 24px));
    padding: 12px 14px;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    background: var(--panel);
    box-shadow: 0 8px 32px rgb(0 0 0 / 45%);
  }
  p {
    flex: 1 1 260px;
    margin: 0;
  }
  .buttons {
    display: flex;
    gap: 8px;
  }
  button {
    height: 34px;
    padding: 0 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel-raised);
    color: var(--text);
    cursor: pointer;
  }
  button.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  @media (pointer: coarse) {
    button {
      height: 44px;
    }
  }
</style>
