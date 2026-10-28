<script lang="ts">
  import { SHADING_TITLES, type Shading, type ViewSettings } from '../app/default-actions';
  import type { Editor } from '../app/editor';
  import {
    SCHEME_VIEW_COLORS,
    THEME_TITLES,
    THEMES,
    VIEW_COLOR_TITLES,
    type ViewColorKey,
  } from '../app/theme';
  import { worldBounds } from '../core/scene-edit';
  import NumberField from './NumberField.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const view = $derived(editor.view);
  const slice = $derived(editor.slice);
  const sceneVersion = $derived(editor.sceneVersion);
  const ui = $derived(editor.ui);
  const pose = $derived(editor.cameraPose);
  const historyVersion = $derived(editor.historyVersion);
  const renderWindow = $derived(editor.renderWindow);
  /** Which camera slots of the document hold a view. */
  const slots = $derived.by(() => {
    void $historyVersion;
    return editor.doc.cameras.map((c) => c !== null);
  });
  const deg = (r: number) => (((r * 180) / Math.PI) % 360 + 360) % 360;
  const SLOT_TIP = 'Click to go (an empty one remembers here), Shift+click to overwrite, right button to clear';

  function slotClick(e: MouseEvent, slot: number): void {
    if (e.shiftKey || !slots[slot]) editor.saveCameraSlot(slot);
    else editor.goToCameraSlot(slot);
  }
  const scheme = $derived(editor.scheme);
  const COLOR_KEYS = Object.keys(VIEW_COLOR_TITLES) as ViewColorKey[];
  const colorOf = (key: ViewColorKey) => $view[key] || SCHEME_VIEW_COLORS[$scheme][key];

  const SHADINGS: Shading[] = ['lit', 'flat', 'clay'];
  const SHADING_TIPS: Record<Shading, string> = {
    lit: 'Light and corner shading',
    flat: 'Palette colors as they are, no light',
    clay: 'One light color: only the shape shows',
  };
  type Flag = { [K in keyof ViewSettings]: ViewSettings[K] extends boolean ? K : never }[keyof ViewSettings];
  const AIDS: { key: Flag; action: string; title: string }[] = [
    { key: 'grid', action: 'view.grid', title: 'Grid' },
    { key: 'floor', action: 'view.floor', title: 'Floor' },
    { key: 'axes', action: 'view.axes', title: 'Axes' },
    { key: 'bounds', action: 'view.bounds', title: 'Dimension box' },
    { key: 'edges', action: 'view.edges', title: 'Voxel edges' },
    { key: 'wireframe', action: 'view.wireframe', title: 'Wireframe' },
    { key: 'outline', action: 'view.outline', title: 'Silhouette outline' },
    { key: 'chunks', action: 'view.chunks', title: 'Chunk borders 32³' },
    { key: 'ao', action: 'view.ao', title: 'Corner shading' },
    { key: 'dimOthers', action: 'view.dimOthers', title: 'Dim the others' },
  ];

  /** Where the slice can go along its axis: around everything in the scene. */
  const range = $derived.by(() => {
    void $sceneVersion;
    const box = worldBounds(editor.doc.scene.objects());
    const axis = $slice?.axis ?? 1;
    if (!box) return { min: -1, max: 32 };
    const [lo, hi] =
      axis === 0 ? [box.minX, box.maxX] : axis === 1 ? [box.minY, box.maxY] : [box.minZ, box.maxZ];
    return { min: lo - 1, max: hi + 1 };
  });
  const moveSliceTo = (at: number) => {
    const s = editor.slice.get();
    if (s) editor.slice.set({ ...s, at });
  };

  const key = (id: string) => editor.actions.shortcut(id) ?? '';
  const set = (patch: Partial<ViewSettings>) => editor.view.update((v) => ({ ...v, ...patch }));
  const DEFAULTS = { lightYaw: 52, lightPitch: 56, lightStrength: 1 };
</script>

<div class="menu">
  <section>
    <h3>Shading</h3>
    <div class="seg wide" role="radiogroup" aria-label="Shading">
      {#each SHADINGS as s (s)}
        <button
          type="button"
          role="radio"
          aria-checked={$view.shading === s}
          class:on={$view.shading === s}
          data-tip={SHADING_TIPS[s]}
          data-key={key(`view.shading.${s}`)}
          onclick={() => set({ shading: s })}>{SHADING_TITLES[s][0]!.toUpperCase() + SHADING_TITLES[s].slice(1)}</button
        >
      {/each}
    </div>
  </section>
  <section>
    <h3>Helpers</h3>
    <div class="aids">
      {#each AIDS as aid (aid.key)}
        <label class="check">
          <input
            type="checkbox"
            checked={$view[aid.key]}
            onchange={(e) => set({ [aid.key]: e.currentTarget.checked })}
          />
          <span class="title">{aid.title}</span>
          {#if key(aid.action)}<kbd>{key(aid.action)}</kbd>{/if}
        </label>
      {/each}
      <label class="check">
        <input
          type="checkbox"
          checked={$renderWindow}
          onchange={(e) => editor.toggleRenderWindow(e.currentTarget.checked)}
        />
        <span class="title">Render window over editing</span>
        {#if key('render.window')}<kbd>{key('render.window')}</kbd>{/if}
      </label>
    </div>
  </section>
  <section>
    <h3>Light</h3>
    <label class="slider">
      <span>Turn</span>
      <input
        type="range"
        min="0"
        max="359"
        value={$view.lightYaw}
        oninput={(e) => set({ lightYaw: Number(e.currentTarget.value) })}
      />
      <NumberField
        label="Light turn"
        value={$view.lightYaw}
        min={0}
        max={359}
        suffix="°"
        reset={DEFAULTS.lightYaw}
        onChange={(v) => set({ lightYaw: v })}
      />
    </label>
    <label class="slider">
      <span>Height</span>
      <input
        type="range"
        min="5"
        max="90"
        value={$view.lightPitch}
        oninput={(e) => set({ lightPitch: Number(e.currentTarget.value) })}
      />
      <NumberField
        label="Light height"
        value={$view.lightPitch}
        min={5}
        max={90}
        suffix="°"
        reset={DEFAULTS.lightPitch}
        onChange={(v) => set({ lightPitch: v })}
      />
    </label>
    <label class="slider">
      <span>Strength</span>
      <input
        type="range"
        min="0"
        max="2"
        step="0.05"
        value={$view.lightStrength}
        oninput={(e) => set({ lightStrength: Number(e.currentTarget.value) })}
      />
      <NumberField
        label="Light strength"
        value={$view.lightStrength}
        min={0}
        max={2}
        step={0.05}
        decimals={2}
        reset={DEFAULTS.lightStrength}
        onChange={(v) => set({ lightStrength: v })}
      />
    </label>
  </section>
  <section>
    <h3>
      <label class="check inline">
        <input
          type="checkbox"
          checked={$slice !== null}
          onchange={() => editor.toggleSlice()}
        />
        Slice
        <kbd>{key('view.slice')}</kbd>
      </label>
    </h3>
    {#if $slice !== null}
      <div class="row">
        <div class="seg" role="radiogroup" aria-label="Slice axis">
          {#each [0, 1, 2] as const as axis (axis)}
            <button
              type="button"
              role="radio"
              aria-checked={$slice.axis === axis}
              class:on={$slice.axis === axis}
              onclick={() => editor.sliceAlong(axis)}>{'XYZ'[axis]}</button
            >
          {/each}
        </div>
        <button
          type="button"
          class="btn"
          data-tip="Hide the other side"
          data-key={key('view.sliceFlip')}
          onclick={() => editor.flipSlice()}>{$slice.dir > 0 ? 'Hide farther ⇄' : 'Hide nearer ⇄'}</button
        >
      </div>
      <label class="slider">
        <span>Visible {$slice.dir > 0 ? 'up to' : 'from'}</span>
        <input
          type="range"
          min={range.min}
          max={range.max}
          value={$slice.at}
          oninput={(e) => moveSliceTo(Number(e.currentTarget.value))}
        />
        <NumberField
          label="Slice: where"
          value={$slice.at}
          min={range.min}
          max={range.max}
          onChange={moveSliceTo}
        />
      </label>
      <p class="note">Beyond the slice nothing shows or gets drawn. Alt+↑ / Alt+↓ — one voxel.</p>
    {/if}
  </section>
  <section>
    <h3>Camera</h3>
    <div class="slots" role="group" aria-label="Document cameras">
      {#each slots as filled, i (i)}
        <button
          type="button"
          class="slot"
          class:filled
          aria-label="Camera {i + 1}{filled ? '' : ', empty'}"
          data-tip={SLOT_TIP}
          onclick={(e) => slotClick(e, i)}
          oncontextmenu={(e) => {
            e.preventDefault();
            editor.clearCameraSlot(i);
          }}>{(i + 1) % 10}</button
        >
      {/each}
    </div>
    <div class="seg wide" role="radiogroup" aria-label="Projection">
      {#each [['perspective', 'Perspective'], ['orthographic', 'Orthographic']] as const as [p, title] (p)}
        <button
          type="button"
          role="radio"
          aria-checked={$pose.projection === p}
          class:on={$pose.projection === p}
          onclick={() => editor.setCameraNumbers({ projection: p })}>{title}</button
        >
      {/each}
    </div>
    <div class="numbers">
      {#each ['x', 'y', 'z'] as const as axis, i (axis)}
        <label class="field">
          <span>{axis.toUpperCase()}</span>
          <NumberField
            label="Camera center, {axis.toUpperCase()}"
            value={$pose.target[i]!}
            step={0.5}
            decimals={1}
            onChange={(v) => editor.setCameraNumbers({ [axis]: v })}
          />
        </label>
      {/each}
      <label class="field">
        <span>Turn</span>
        <NumberField
          label="Camera turn"
          value={deg($pose.yaw)}
          suffix="°"
          onChange={(v) => editor.setCameraNumbers({ yaw: v })}
        />
      </label>
      <label class="field">
        <span>Tilt</span>
        <NumberField
          label="Camera tilt"
          value={($pose.pitch * 180) / Math.PI}
          min={-89}
          max={89}
          suffix="°"
          onChange={(v) => editor.setCameraNumbers({ pitch: v })}
        />
      </label>
      <label class="field">
        <span>Distance</span>
        <NumberField
          label="Distance to the center"
          value={$pose.distance}
          min={1}
          decimals={1}
          step={0.5}
          onChange={(v) => editor.setCameraNumbers({ distance: v })}
        />
      </label>
      {#if $pose.projection === 'perspective'}
        <label class="field">
          <span>Field of view</span>
          <NumberField
            label="Field of view"
            value={$pose.fov}
            min={5}
            max={120}
            suffix="°"
            reset={45}
            onChange={(v) => editor.setCameraNumbers({ fov: v })}
          />
        </label>
      {/if}
    </div>
  </section>
  <section>
    <h3>Appearance</h3>
    <div class="seg wide" role="radiogroup" aria-label="Theme">
      {#each THEMES as t (t)}
        <button
          type="button"
          role="radio"
          aria-checked={$ui.theme === t}
          class:on={$ui.theme === t}
          onclick={() => editor.ui.update((u) => ({ ...u, theme: t }))}>{THEME_TITLES[t]}</button
        >
      {/each}
    </div>
    <div class="colors">
      {#each COLOR_KEYS as k (k)}
        <label class="color" data-tip="{VIEW_COLOR_TITLES[k]} in the viewport">
          <input
            type="color"
            value={colorOf(k)}
            oninput={(e) => set({ [k]: e.currentTarget.value })}
          />
          <span>{VIEW_COLOR_TITLES[k]}</span>
        </label>
      {/each}
    </div>
    {#if COLOR_KEYS.some((k) => $view[k])}
      <button
        type="button"
        class="btn reset"
        onclick={() => set({ background: '', gridColor: '', edgeColor: '', selectionColor: '' })}
        >Colors as in the theme</button
      >
    {/if}
  </section>
</div>

<style>
  .menu {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 300px;
    padding: 12px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h3 {
    margin: 0;
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 500;
  }
  .wide {
    display: flex;
  }
  .wide > button {
    flex: 1;
  }
  .aids {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    padding: 0 4px;
    border-radius: var(--radius-s);
    color: var(--text);
    cursor: pointer;
  }
  .check:hover {
    background: var(--hover);
  }
  .check.inline {
    padding: 0;
    color: var(--text-faint);
  }
  .check.inline:hover {
    background: none;
    color: var(--text);
  }
  .check input {
    margin: 0;
    accent-color: var(--accent);
  }
  .title {
    flex: 1;
  }
  .slider {
    display: grid;
    grid-template-columns: 64px 1fr 56px;
    align-items: center;
    gap: 8px;
    color: var(--text-dim);
  }
  .slider input {
    width: 100%;
    accent-color: var(--accent);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .slots {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    gap: 3px;
  }
  .slot {
    height: 26px;
    padding: 0;
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius-s);
    background: none;
    color: var(--text-faint);
    font: 12px var(--mono);
    cursor: pointer;
  }
  .slot.filled {
    border: 1px solid transparent;
    background: var(--surface-2);
    color: var(--text);
  }
  .slot:hover {
    border-color: var(--accent);
  }
  .numbers {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 4px 6px;
  }
  .field {
    display: grid;
    gap: 2px;
    color: var(--text-dim);
    font-size: 11px;
  }
  .colors {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .color {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    padding: 0 4px;
    border-radius: var(--radius-s);
    color: var(--text);
    cursor: pointer;
  }
  .color:hover {
    background: var(--hover);
  }
  .color input {
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 5px;
    background: none;
    cursor: pointer;
  }
  .color input::-webkit-color-swatch-wrapper {
    padding: 0;
  }
  .color input::-webkit-color-swatch {
    border: 0;
    border-radius: 4px;
  }
  .reset {
    align-self: flex-start;
  }
  .note {
    margin: 0;
    color: var(--text-faint);
    font-size: 12px;
  }
  @media (pointer: coarse) {
    .check {
      min-height: 40px;
    }
  }
</style>
