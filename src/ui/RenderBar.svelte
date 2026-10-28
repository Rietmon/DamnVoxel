<script lang="ts">
  import type { Editor } from '../app/editor';
  import type { RenderSettings } from '../app/render-scene';
  import NumberField from './NumberField.svelte';
  import Popover from './Popover.svelte';
  import RenderMenu from './RenderMenu.svelte';
  import RenderSaveMenu from './RenderSaveMenu.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const settings = $derived(editor.renderSettings);
  const status = $derived(editor.renderStatus);
  const job = $derived(editor.renderJob);
  let saveButton = $state<HTMLElement>();
  let saveOpen = $state(false);
  let menuButton = $state<HTMLElement>();
  let menuOpen = $state(false);
  const set = (patch: Partial<RenderSettings>) => editor.renderSettings.update((s) => ({ ...s, ...patch }));
</script>

<span class="mode">Render</span>
{#if $job}
  <span class="label progress" data-tip="Saving; keep editing, the file will download by itself">
    {$job.label} · {Math.round($job.progress * 100)}%
  </span>
  <button type="button" class="btn" onclick={() => editor.cancelRenderJob()}>Cancel</button>
{:else if $status.problem}
  <span class="label problem">{$status.problem}</span>
{:else}
  <span class="label progress" data-tip="Samples per pixel: the picture gets cleaner with each">
    {$status.samples} / {$settings.samples}
  </span>
{/if}
<span class="sep"></span>
<span class="label">Sun</span>
<span class="num">
  <NumberField label="Sun turn" value={$settings.sunYaw} min={0} max={359} suffix="°" onChange={(v) => set({ sunYaw: v })} />
</span>
<span class="num">
  <NumberField label="Sun height" value={$settings.sunPitch} min={1} max={90} suffix="°" onChange={(v) => set({ sunPitch: v })} />
</span>
<span class="label">Exposure</span>
<span class="num">
  <NumberField
    label="Exposure"
    value={$settings.exposure}
    min={0.05}
    max={8}
    step={0.05}
    decimals={2}
    reset={1}
    onChange={(v) => set({ exposure: v })}
  />
</span>
<button
  type="button"
  class="btn"
  class:on={menuOpen}
  aria-haspopup="dialog"
  aria-expanded={menuOpen}
  data-tip="Sky, bounces, fog, depth of field, bloom, denoising, saving"
  bind:this={menuButton}
  onclick={() => (menuOpen = !menuOpen)}>Settings ▾</button
>
<button
  type="button"
  class="btn"
  class:on={saveOpen}
  aria-haspopup="dialog"
  aria-expanded={saveOpen}
  data-tip="A PNG frame of any size, turntable or animation as GIF and video, sprites"
  bind:this={saveButton}
  onclick={() => (saveOpen = !saveOpen)}>Save ▾</button
>

{#if saveOpen && saveButton}
  <Popover anchor={saveButton} label="Save render" onClose={() => (saveOpen = false)}>
    <RenderSaveMenu {editor} />
  </Popover>
{/if}

{#if menuOpen && menuButton}
  <Popover anchor={menuButton} label="Render settings" onClose={() => (menuOpen = false)}>
    <RenderMenu {editor} />
  </Popover>
{/if}

<style>
  .mode {
    flex: none;
    padding: 4px 10px;
    border-radius: var(--radius-s);
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }
  .progress {
    font: 12px var(--mono);
    white-space: nowrap;
  }
  .problem {
    color: var(--danger);
  }
  .num {
    flex: none;
    width: 52px;
  }
</style>
