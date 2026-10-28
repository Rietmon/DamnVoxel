<script lang="ts">
  interface Props {
    onApply: () => void;
  }
  const { onApply }: Props = $props();
  let hidden = $state(false);
</script>

{#if !hidden}
  <div class="banner" role="status">
    <span>A new version of the editor is available.</span>
    <button type="button" onclick={onApply}>Restart</button>
    <button type="button" class="ghost" onclick={() => (hidden = true)}>Later</button>
  </div>
{/if}

<style>
  .banner {
    position: fixed;
    left: 50%;
    bottom: calc(16px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 12px;
    border-radius: 10px;
    background: #2a2d35;
    color: #e8e9ec;
    font: 14px system-ui, sans-serif;
    box-shadow: 0 6px 24px rgb(0 0 0 / 40%);
    z-index: 1000;
  }
  button {
    font: inherit;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid #ff9f43;
    background: #ff9f43;
    color: #1b1d22;
    cursor: pointer;
  }
  .ghost {
    background: transparent;
    color: #e8e9ec;
    border-color: #4a4e58;
  }
</style>
