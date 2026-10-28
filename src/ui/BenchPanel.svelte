<script lang="ts">
  import type { BenchResult } from '../app/bench';
  import type { Readable } from '../app/store';

  interface Props {
    result: Readable<BenchResult | null>;
  }
  const { result }: Props = $props();
  const r = $derived(result);
  const ms = (v: number) => v.toFixed(2);
</script>

{#if $r}
  <div class="panel" role="status">
    <h2>Viewport benchmark · {$r.scene}</h2>
    <div>chunks <b>{$r.chunks}</b> · voxels <b>{$r.voxelMB.toFixed(1)} MB</b></div>
    <div>chunk meshing: median <b>{ms($r.meshMedianMs)}</b> · p95 <b>{ms($r.meshP95Ms)}</b> · max <b>{ms($r.meshMaxMs)} ms</b></div>
    {#if $r.stage === 'done'}
      <div>orbit: <b>{$r.fps} fps</b> · frame p95 <b>{ms($r.frameP95Ms)} ms</b> · slow <b>{$r.slowFramePercent.toFixed(1)}%</b></div>
      <div>meshes on the GPU <b>{$r.meshMB.toFixed(1)} MB</b></div>
    {:else}
      <div>camera orbit running…</div>
    {/if}
  </div>
{/if}

<style>
  .panel {
    position: absolute;
    top: 8px;
    left: 8px;
    max-width: calc(100% - 16px);
    padding: 8px 10px;
    border-radius: 8px;
    background: rgb(0 0 0 / 65%);
    color: #cfd3da;
    font: 12px/1.5 var(--mono);
  }
  h2 {
    margin: 0 0 4px;
    font: 600 13px var(--font);
    color: #fff;
  }
  b {
    color: #fff;
  }
</style>
