<script lang="ts">
  import type { Editor } from '../app/editor';
  import type { RenderSettings } from '../app/render-scene';
  import type { SequenceKind, SequenceSettings } from '../app/render-sequence';
  import NumberField from './NumberField.svelte';

  /**
   * What the render saves (docs/rendering.md, “Large frames”, “Frame series”): one PNG of any
   * size, or a series — a turntable or the animation as GIF or video, sprites as a PNG sheet.
   */
  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const s = $derived(editor.renderSettings);
  const frame = $derived(editor.frameSize);
  const q = $derived(editor.sequence);
  const job = $derived(editor.renderJob);
  const historyVersion = $derived(editor.historyVersion);
  const animation = $derived.by(() => {
    void $historyVersion;
    return editor.doc.animation;
  });

  const set = (patch: Partial<RenderSettings>) => editor.renderSettings.update((v) => ({ ...v, ...patch }));
  const setFrame = (patch: Partial<{ width: number; height: number }>) =>
    editor.frameSize.update((f) => ({ ...f, ...patch }));
  const setQ = (patch: Partial<SequenceSettings>) => editor.sequence.update((v) => ({ ...v, ...patch }));

  const SIZES: { title: string; size: () => { width: number; height: number } }[] = [
    { title: 'As the view', size: () => editor.viewPixelSize() },
    { title: '1080p', size: () => ({ width: 1920, height: 1080 }) },
    { title: '4K', size: () => ({ width: 3840, height: 2160 }) },
    { title: 'Square', size: () => ({ width: 2048, height: 2048 }) },
  ];
  const KINDS: { id: SequenceKind; title: string }[] = [
    { id: 'turntable', title: 'Turntable' },
    { id: 'animation', title: 'Animation' },
    { id: 'sprites', title: 'Sprites' },
  ];
  const saveTitle = $derived(
    $q.kind === 'sprites'
      ? `Save sprites ${$q.directions} × ${$q.spriteSize}px`
      : `Save ${$q.format === 'gif' ? 'GIF' : 'video'}`,
  );
</script>

<div class="menu">
  {#if $job}
    <section>
      <h3>Saving: {$job.label}</h3>
      <div class="line">
        <span class="bar" role="progressbar" aria-label="Saving" aria-valuenow={Math.round($job.progress * 100)}>
          <span style:width="{$job.progress * 100}%"></span>
        </span>
        <span class="pct">{Math.round($job.progress * 100)}%</span>
        <button type="button" class="btn" onclick={() => editor.cancelRenderJob()}>Cancel</button>
      </div>
      <p class="hint">Keep editing: frames are traced a few passes at a time, the file will download by itself.</p>
    </section>
  {/if}
  <section>
    <h3>Frame</h3>
    <div class="size">
      <NumberField label="Frame width" value={$frame.width} min={16} max={8192} onChange={(v) => setFrame({ width: v })} />
      <span>×</span>
      <NumberField label="Frame height" value={$frame.height} min={16} max={8192} onChange={(v) => setFrame({ height: v })} />
      <span class="hint">px</span>
    </div>
    <div class="chips">
      {#each SIZES as p (p.title)}
        <button type="button" class="btn" onclick={() => setFrame(p.size())}>{p.title}</button>
      {/each}
    </div>
    <label class="check"><input type="checkbox" checked={$s.transparent} onchange={(e) => set({ transparent: e.currentTarget.checked })} />Transparent background: the model only</label>
    <button type="button" class="btn save" disabled={$job !== null} onclick={() => editor.saveRenderFrame()}>
      Save PNG {$frame.width}×{$frame.height}
    </button>
  </section>
  <section>
    <h3>Frame series</h3>
    <div class="seg wide" role="radiogroup" aria-label="What to shoot">
      {#each KINDS as k (k.id)}
        <button type="button" role="radio" aria-checked={$q.kind === k.id} class:on={$q.kind === k.id} onclick={() => setQ({ kind: k.id })}>{k.title}</button>
      {/each}
    </div>
    {#if $q.kind === 'sprites'}
      <div class="row">
        <span>Sides</span>
        <span class="seg" role="radiogroup" aria-label="Sides">
          {#each [4, 8] as const as d (d)}
            <button type="button" role="radio" aria-checked={$q.directions === d} class:on={$q.directions === d} onclick={() => setQ({ directions: d })}>{d}</button>
          {/each}
        </span>
      </div>
      <div class="row">
        <span>Tilt</span>
        <span class="seg" role="radiogroup" aria-label="Camera tilt">
          <button type="button" role="radio" aria-checked={$q.tilt === 'pixel'} class:on={$q.tilt === 'pixel'} data-tip="2:1 lines, as in pixel art: 30°" onclick={() => setQ({ tilt: 'pixel' })}>2:1</button>
          <button type="button" role="radio" aria-checked={$q.tilt === 'iso'} class:on={$q.tilt === 'iso'} data-tip="True isometry: 35.3°" onclick={() => setQ({ tilt: 'iso' })}>Iso</button>
        </span>
      </div>
      <label class="row">
        <span>Cell</span>
        <NumberField label="Sprite size" value={$q.spriteSize} min={8} max={1024} suffix=" px" onChange={(v) => setQ({ spriteSize: v })} />
      </label>
      <label class="check"><input type="checkbox" checked={$q.pixelated} onchange={(e) => setQ({ pixelated: e.currentTarget.checked })} />Pixelated: no smoothing of edges</label>
      <label class="check"><input type="checkbox" checked={$q.animated} onchange={(e) => setQ({ animated: e.currentTarget.checked })} />Animation frames as sheet rows</label>
      <p class="hint">An orthographic camera, the same light from every side, a transparent background. PNG sheet: sides go across.</p>
    {:else}
      {#if $q.kind === 'turntable'}
        <label class="row">
          <span>Frames per turn</span>
          <NumberField label="Frames per turn" value={$q.frames} min={2} max={720} onChange={(v) => setQ({ frames: v })} />
        </label>
        <label class="row">
          <span>Frames per second</span>
          <NumberField label="Frames per second" value={$q.fps} min={1} max={60} onChange={(v) => setQ({ fps: v })} />
        </label>
        <label class="check"><input type="checkbox" checked={$q.lightFollows} onchange={(e) => setQ({ lightFollows: e.currentTarget.checked })} />The light turns with the camera</label>
      {:else}
        <p class="hint">Frames {animation.start}–{animation.end}, {animation.fps} per second — as on the timeline.</p>
      {/if}
      <div class="size">
        <NumberField label="Width" value={$q.width} min={16} max={4096} onChange={(v) => setQ({ width: v })} />
        <span>×</span>
        <NumberField label="Height" value={$q.height} min={16} max={4096} onChange={(v) => setQ({ height: v })} />
        <span class="hint">px</span>
      </div>
      <div class="seg wide" role="radiogroup" aria-label="Format">
        <button type="button" role="radio" aria-checked={$q.format === 'gif'} class:on={$q.format === 'gif'} onclick={() => setQ({ format: 'gif' })}>GIF</button>
        <button type="button" role="radio" aria-checked={$q.format === 'video'} class:on={$q.format === 'video'} onclick={() => setQ({ format: 'video' })}>Video</button>
      </div>
      {#if $q.format === 'video'}
        <p class="hint">The browser records the video (MP4 or WebM) in real time; the background is opaque.</p>
      {/if}
    {/if}
    <label class="row">
      <span>Samples per frame</span>
      <NumberField label="Samples per frame" value={$q.samples} min={1} max={8192} onChange={(v) => setQ({ samples: v })} />
    </label>
    <button type="button" class="btn save" disabled={$job !== null} onclick={() => editor.saveRenderSequence()}>
      {saveTitle}
    </button>
  </section>
</div>

<style>
  .menu {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 300px;
    padding: 12px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h3 {
    margin: 4px 0 0;
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 500;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 8px;
    color: var(--text-dim);
  }
  .row > :global(:last-child:not(.seg)) {
    width: 80px;
  }
  .size {
    display: grid;
    grid-template-columns: 72px auto 72px auto;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }
  .wide {
    display: flex;
  }
  .wide > button {
    flex: 1;
  }
  .save {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }
  .save:hover:not(:disabled) {
    background: var(--accent);
    color: var(--accent-text);
    filter: brightness(1.08);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .bar {
    flex: 1;
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
  .hint {
    margin: 0;
    color: var(--text-faint);
    font-size: 12px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    color: var(--text);
    cursor: pointer;
  }
  .check input {
    accent-color: var(--accent);
  }
</style>
