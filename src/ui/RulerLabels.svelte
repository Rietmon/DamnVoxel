<script lang="ts">
  import type { Editor } from '../app/editor';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const labels = $derived(editor.rulerLabels);
  const AXIS = ['x', 'y', 'z'];
</script>

<div class="layer" aria-hidden="true">
  {#each $labels as label (label.axis)}
    <span class="label {AXIS[label.axis]}" style:transform="translate({label.x}px, {label.y}px)">
      {label.text}
    </span>
  {/each}
</div>

<style>
  .layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .label {
    position: absolute;
    left: 0;
    top: 0;
    translate: -50% -50%;
    padding: 0 4px;
    border-radius: 4px;
    background: rgb(20 22 26 / 72%);
    font: 600 11px/16px var(--mono);
    white-space: nowrap;
  }
  .x {
    color: #ff8a8c;
  }
  .y {
    color: #7fd48d;
  }
  .z {
    color: #7fb0ff;
  }
</style>
