<script lang="ts">
  import type { Editor } from '../app/editor';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const label = $derived(editor.selectionLabel);
</script>

{#if $label}
  <div class="label" style:transform="translate({$label.x}px, {$label.y}px)" aria-hidden="true">
    {$label.text}
  </div>
{/if}

<style>
  .label {
    position: absolute;
    left: 0;
    top: 0;
    translate: -50% calc(-100% - 8px);
    padding: 1px 6px;
    border-radius: 4px;
    background: rgb(32 72 128 / 85%);
    color: #e6f1ff;
    font: 600 11px/16px var(--mono);
    white-space: nowrap;
    pointer-events: none;
  }
</style>
