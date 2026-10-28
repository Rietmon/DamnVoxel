<script lang="ts">
  import type { Editor } from '../app/editor';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const paths = $derived(editor.screenOverlay);

  function d(points: [number, number][], closed: boolean): string {
    return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ') + (closed ? ' Z' : '');
  }
</script>

<svg class="layer" aria-hidden="true">
  {#each $paths as path, i (i)}
    <path class="back" d={d(path.points, path.closed)} />
    <path class="front" d={d(path.points, path.closed)} />
  {/each}
</svg>

<style>
  .layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }
  path {
    fill: none;
    stroke-linejoin: round;
  }
  .back {
    stroke: rgb(0 0 0 / 60%);
    stroke-width: 3;
  }
  .front {
    stroke: #73b8ff;
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
    fill: rgb(115 184 255 / 8%);
  }
</style>
