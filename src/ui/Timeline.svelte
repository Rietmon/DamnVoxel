<script lang="ts">
  import type { Editor } from '../app/editor';
  import { AnimationSettingsCommand, animatedNodes, keyFrames } from '../core/animation';
  import Icon from './Icon.svelte';
  import NumberField from './NumberField.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const frame = $derived(editor.animFrame);
  const playing = $derived(editor.playing);
  const sceneVersion = $derived(editor.sceneVersion);
  const history = $derived(editor.historyVersion);
  const active = $derived(editor.activeObject);
  const view = $derived(editor.view);
  let track = $state<HTMLElement>();

  const anim = $derived.by(() => {
    void $sceneVersion;
    void $history;
    return { ...editor.doc.animation };
  });
  /** Key frames of the edited object, and of everything (fainter). */
  const keys = $derived.by(() => {
    void $sceneVersion;
    void $history;
    const mine = $active ? keyFrames($active) : [];
    const all = new Set(animatedNodes(editor.doc).flatMap((n) => keyFrames(n)));
    return { mine: new Set(mine), all: [...all] };
  });
  const span = $derived(Math.max(1, anim.end - anim.start));
  const pos = (f: number) => `${((f - anim.start) / span) * 100}%`;

  function settings(patch: Record<string, number | boolean>, merge: boolean): void {
    editor.doc.history.execute(new AnimationSettingsCommand(editor.doc, patch), { merge });
  }

  /** Dragging along the track scrubs frames. */
  function scrub(e: PointerEvent): void {
    if (e.button !== 0 || !track) return;
    const el = track;
    el.setPointerCapture(e.pointerId);
    const at = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      editor.goToFrame(anim.start + Math.round(t * span));
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  const run = (id: string) => editor.actions.run(id);
  const key = (id: string) => editor.actions.shortcut(id) ?? '';
  const onKey = $derived(keys.mine.has($frame));
</script>

<div class="timeline" role="toolbar" aria-label="Animation">
  <div class="controls">
    <button type="button" class="btn icon" aria-label="Previous frame" data-tip="Previous frame" data-key={key('anim.prev')} onclick={() => run('anim.prev')}>◀</button>
    <button
      type="button"
      class="btn icon play"
      class:on={$playing}
      aria-label={$playing ? 'Stop' : 'Play'}
      data-tip={$playing ? 'Stop' : 'Play'}
      data-key={key('anim.play')}
      onclick={() => run('anim.play')}>{$playing ? '❚❚' : '▶'}</button
    >
    <button type="button" class="btn icon" aria-label="Next frame" data-tip="Next frame" data-key={key('anim.next')} onclick={() => run('anim.next')}>▶▏</button>
    <span class="num frame">
      <NumberField label="Frame" value={$frame} min={0} max={9999} onChange={(v) => editor.goToFrame(v)} />
    </span>
  </div>
  <div class="track" bind:this={track} role="slider" tabindex="-1" aria-label="Frame" aria-valuemin={anim.start} aria-valuemax={anim.end} aria-valuenow={$frame} onpointerdown={scrub}>
    {#each Array.from({ length: Math.min(span, 200) + 1 }, (_, i) => anim.start + Math.round((i * span) / Math.min(span, 200))) as f (f)}
      <span class="tick" style:left={pos(f)}></span>
    {/each}
    {#each keys.all as f (f)}
      {#if f >= anim.start && f <= anim.end}
        <span class="key" class:mine={keys.mine.has(f)} style:left={pos(f)} title="Key: frame {f}"></span>
      {/if}
    {/each}
    <span class="head" style:left={pos(Math.min(anim.end, Math.max(anim.start, $frame)))}></span>
  </div>
  <div class="range">
    <span class="num">
      <NumberField label="Start" value={anim.start} min={0} max={anim.end} tip="Start of the range" onChange={(v, live) => settings({ start: v }, live)} onEnd={() => editor.doc.history.closeMerge()} />
    </span>
    <span class="dash">–</span>
    <span class="num">
      <NumberField label="End" value={anim.end} min={anim.start} max={9999} tip="End of the range" onChange={(v, live) => settings({ end: v }, live)} onEnd={() => editor.doc.history.closeMerge()} />
    </span>
    <span class="num fps">
      <NumberField label="Frames per second" value={anim.fps} min={1} max={60} suffix=" fps" onChange={(v, live) => settings({ fps: v }, live)} onEnd={() => editor.doc.history.closeMerge()} />
    </span>
    <button type="button" class="btn" class:on={anim.loop} aria-pressed={anim.loop} data-tip="Loop" onclick={() => settings({ loop: !anim.loop }, false)}>⟳</button>
    <button
      type="button"
      class="btn"
      class:on={anim.smooth}
      aria-pressed={anim.smooth}
      data-tip="Smooth: the position glides between keys instead of holding until the next one"
      onclick={() => {
        settings({ smooth: !anim.smooth }, false);
        editor.goToFrame($frame);
      }}>Smooth</button
    >
    {#if anim.smooth}
      <button
        type="button"
        class="btn"
        data-tip="Bake the glide into keys on every frame — this is how MagicaVoxel will see it"
        onclick={() => run('anim.bake')}>Bake</button
      >
    {/if}
  </div>
  <div class="keys">
    <button
      type="button"
      class="btn"
      class:on={$view.onion}
      aria-pressed={$view.onion}
      data-tip="Onion skin: neighbor key frames are shown faded (earlier in blue, later in orange)"
      data-key={key('view.onion')}
      onclick={() => run('view.onion')}>Onion</button
    >
    <button type="button" class="btn" data-tip="Model frame here: a copy of what is visible; edits go into it" onclick={() => run('anim.keyModel')}>+ Model</button>
    <button type="button" class="btn" data-tip="Position key here: move the object and the key updates" onclick={() => run('anim.keyPlace')}>+ Position</button>
    <button type="button" class="btn icon" aria-label="Remove the keys on this frame" data-tip="Remove the keys of this frame" disabled={!onKey} onclick={() => { run('anim.deleteModel'); run('anim.deletePlace'); }}>
      <Icon name="close" />
    </button>
  </div>
</div>

<style>
  .timeline {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    min-height: 44px;
    padding: 4px 10px;
    border-top: 1px solid var(--line);
    background: var(--surface);
  }
  .controls,
  .range,
  .keys {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .play {
    color: var(--accent);
  }
  .num {
    width: 52px;
  }
  .fps {
    width: 64px;
  }
  .dash {
    color: var(--text-faint);
  }
  .track {
    position: relative;
    flex: 1;
    min-width: 160px;
    height: 28px;
    border-radius: var(--radius-s);
    background: var(--surface-2);
    cursor: ew-resize;
    touch-action: none;
  }
  .tick {
    position: absolute;
    top: 18px;
    width: 1px;
    height: 6px;
    background: var(--line-strong);
  }
  .key {
    position: absolute;
    top: 9px;
    width: 9px;
    height: 9px;
    margin-left: -4px;
    rotate: 45deg;
    background: var(--text-faint);
  }
  .key.mine {
    background: var(--accent);
  }
  .head {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--text);
  }
</style>
