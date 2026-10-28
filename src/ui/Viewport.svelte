<script lang="ts">
  import type { Editor } from '../app/editor';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  let canvas: HTMLCanvasElement;

  $effect(() => {
    editor.attach(canvas);
    const observer = new ResizeObserver(() => editor.resize());
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      editor.detach();
    };
  });
</script>

<canvas bind:this={canvas} tabindex="-1" aria-label="3D view"></canvas>

<style>
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    outline: none;
  }
</style>
