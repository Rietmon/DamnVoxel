<script lang="ts">
  import type { Editor } from '../app/editor';

  /** A render being saved, shown over the editing view (the render bar shows it in “Render”). */
  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const job = $derived(editor.renderJob);
  const rendering = $derived(editor.rendering);
</script>

{#if $job && !$rendering}
  <div class="job float" role="status">
    <span class="label">{$job.label}</span>
    <span class="bar"><span style:width="{$job.progress * 100}%"></span></span>
    <span class="pct">{Math.round($job.progress * 100)}%</span>
    <button type="button" class="btn" onclick={() => editor.cancelRenderJob()}>Cancel</button>
  </div>
{/if}

<style>
  .job {
    position: absolute;
    left: 50%;
    bottom: 12px;
    z-index: 4;
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: calc(100% - 24px);
    padding: 4px 4px 4px 12px;
  }
  .label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bar {
    flex: none;
    width: 96px;
    height: 6px;
    border-radius: 3px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar > span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .pct {
    width: 36px;
    font: 12px var(--mono);
    text-align: right;
  }
</style>
