<script lang="ts">
  import type { Editor } from '../app/editor';
  import { type CubeRegion, cubeRegions, FACE_LABELS, regionAt, sameDir } from '../app/view-cube';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const pose = $derived(editor.cameraPose);
  /** A title with the action's shortcut: “Isometric (Alt+0)”. */
  const tip = (title: string, id: string) => {
    const key = editor.actions.shortcut(id);
    return key ? `${title} (${key})` : title;
  };
  const cameraOnly = $derived(editor.cameraOnlyTouch);
  /** Phones and tablets get a toggle for moving the camera with one finger. */
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  /** Widget size in CSS pixels. */
  const SIZE = 96;
  let canvas: HTMLCanvasElement;
  let hovered = $state<CubeRegion | null>(null);
  let regions: CubeRegion[] = [];

  function draw(yaw: number, pitch: number, hover: CubeRegion | null): void {
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== SIZE * ratio) {
      canvas.width = SIZE * ratio;
      canvas.height = SIZE * ratio;
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    regions = cubeRegions(yaw, pitch, SIZE);
    for (const r of regions) {
      const isFace = Math.abs(r.dir[0]) + Math.abs(r.dir[1]) + Math.abs(r.dir[2]) === 1;
      const lit = 0.35 + 0.5 * r.facing;
      const base = isFace ? 62 * lit + 30 : 50 * lit + 26;
      const active = hover && sameDir(hover.dir, r.dir);
      ctx.fillStyle = active ? '#ff9f43' : `rgb(${base} ${base + 3} ${base + 9})`;
      ctx.beginPath();
      for (const [i, [x, y]] of r.polygon.entries()) {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgb(20 22 26 / 70%)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of regions) {
      if (Math.abs(r.dir[0]) + Math.abs(r.dir[1]) + Math.abs(r.dir[2]) !== 1) continue;
      if (r.facing < 0.25) continue;
      const cx = r.polygon.reduce((s, p) => s + p[0], 0) / 4;
      const cy = r.polygon.reduce((s, p) => s + p[1], 0) / 4;
      const active = hover && sameDir(hover.dir, r.dir);
      ctx.fillStyle = active ? '#1b1d22' : `rgb(232 233 236 / ${Math.min(1, r.facing * 1.4)})`;
      ctx.fillText(FACE_LABELS[r.face]!, cx, cy);
    }
  }

  $effect(() => {
    draw($pose.yaw, $pose.pitch, hovered);
  });

  function local(e: PointerEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onMove(e: PointerEvent): void {
    const [x, y] = local(e);
    hovered = regionAt(regions, x, y);
  }

  function onClick(e: PointerEvent): void {
    const [x, y] = local(e);
    const region = regionAt(regions, x, y);
    if (region) editor.viewAlong(region.dir);
  }
</script>

<div class="cube">
  <canvas
    bind:this={canvas}
    style:width="{SIZE}px"
    style:height="{SIZE}px"
    onpointermove={onMove}
    onpointerleave={() => (hovered = null)}
    onpointerup={onClick}
    aria-label="View cube: press a face, an edge or a corner to look from that side"
  ></canvas>
  <div class="buttons">
    <button
      type="button"
      title={tip(
        $pose.projection === 'perspective'
          ? 'Perspective — switch to orthographic'
          : 'Orthographic — switch to perspective',
        'camera.projection',
      )}
      onclick={() => editor.toggleProjection()}
    >
      {#if $pose.projection === 'perspective'}
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5 L16 3 L16 17 L4 15 Z" /></svg>
      {:else}
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4 H16 V16 H4 Z" /></svg>
      {/if}
    </button>
    <button type="button" title={tip('Isometric', 'camera.iso')} onclick={() => editor.viewIsometric()}>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 2 L17 6 L17 14 L10 18 L3 14 L3 6 Z M3 6 L10 10 L17 6 M10 10 V18" />
      </svg>
    </button>
    {#if coarse}
      <button
        type="button"
        class:on={$cameraOnly}
        aria-pressed={$cameraOnly}
        title={tip('One finger moves the camera, not the tool', 'camera.touchOnly')}
        onclick={() => editor.cameraOnlyTouch.update((v) => !v)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M7 11 V4.5 a1.3 1.3 0 0 1 2.6 0 V10 M9.6 9 V3.5 a1.3 1.3 0 0 1 2.6 0 V10 M12.2 9.5 V5 a1.3 1.3 0 0 1 2.6 0 V12 c0 3 -2 5 -5 5 c-2.5 0 -3.6 -1.2 -5 -3.5 L3.2 11 a1.2 1.2 0 0 1 2 -1.3 L7 12" />
        </svg>
      </button>
    {/if}
    <button type="button" title={tip('Frame model', 'camera.fit')} onclick={() => editor.fitActive()}>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M3 7 V3 H7 M13 3 H17 V7 M17 13 V17 H13 M7 17 H3 V13" />
        <rect x="7" y="7" width="6" height="6" />
      </svg>
    </button>
  </div>
</div>

<style>
  .cube {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    user-select: none;
  }
  canvas {
    display: block;
    cursor: pointer;
    touch-action: none;
  }
  .buttons {
    display: flex;
    gap: 4px;
  }
  button {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--float);
    cursor: pointer;
  }
  button:hover {
    border-color: var(--border-strong);
    background: var(--panel-raised);
  }
  button.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: var(--text);
    stroke-width: 1.4;
    stroke-linejoin: round;
  }
</style>
