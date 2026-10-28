<script lang="ts">
  import type { Editor } from '../app/editor';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const stats = $derived(editor.stats);
</script>

<div class="stats" aria-hidden="true">
  <div>frames <b>{$stats.frames}</b></div>
  <div>fps <b>{$stats.fps || '—'}</b></div>
  <div>frame CPU <b>{$stats.cpuMs.toFixed(1)} ms</b></div>
  <div>resolution <b>{Math.round($stats.renderScale * 100)}%</b></div>
  <div>draw calls <b>{$stats.drawCalls}</b> · culled <b>{$stats.culled}</b></div>
  <div>quads <b>{$stats.quads.toLocaleString('en-US')}</b></div>
  <div>meshes <b>{$stats.gpuMB.toFixed(1)} MB</b>{#if $stats.meshing} · meshing…{/if}</div>
</div>

<style>
  .stats {
    position: absolute;
    left: 8px;
    bottom: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    background: rgb(0 0 0 / 55%);
    color: #cfd3da;
    font: 11px/1.45 var(--mono);
    pointer-events: none;
    white-space: nowrap;
  }
  b {
    color: #fff;
    font-weight: 600;
  }
</style>
