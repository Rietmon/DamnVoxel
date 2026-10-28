<script lang="ts">
  import type { Editor } from '../app/editor';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const notice = $derived(editor.notice);
</script>

{#if $notice}
  {#key $notice.id}
    <div class="toast" role="status">{$notice.text}</div>
  {/key}
{/if}

<style>
  .toast {
    position: absolute;
    left: 50%;
    top: 12px;
    translate: -50% 0;
    max-width: calc(100% - 32px);
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--float);
    color: var(--text);
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
    animation: fade 1.6s ease forwards;
  }
  /* On narrow screens keep clear of the view cube in the top right corner. */
  @media (max-width: 600px) {
    .toast {
      left: 12px;
      translate: none;
      max-width: calc(100% - 140px);
    }
  }
  @keyframes fade {
    0% {
      opacity: 0;
      transform: translateY(-4px);
    }
    10%,
    75% {
      opacity: 1;
      transform: none;
    }
    100% {
      opacity: 0;
    }
  }
</style>
