<script lang="ts">
  import type { Editor } from '../app/editor';
  import type { EditMask, SelectMode } from '../core/selection-edit';
  import type { RegionMode } from '../core/tools/select-regions';
  import { CURVE_TITLES, type CurveMode } from '../core/tools/curve-tool';
  import { FILL_TITLES, type FillMode } from '../core/tools/fill-tool';
  import { SDF_TITLES, type SdfShape } from '../core/tools/sdf-tool';
  import { SCULPT_TITLES, type SculptDirection, type SculptMode } from '../core/tools/sculpt';
  import { MAX_BRUSH_SIZE } from '../core/tools/stamp';
  import type { BrushMode, ToolSettings } from '../core/tools/tool';
  import Icon from './Icon.svelte';
  import NumberField from './NumberField.svelte';
  import SelectionSets from './SelectionSets.svelte';
  import Popover from './Popover.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const tools = $derived(editor.tools);
  const settings = $derived(tools.settingsStore);
  const toolId = $derived(tools.activeToolId);
  const mode = $derived(editor.mode);
  const selected = $derived(editor.selectedNodes);
  const holding = $derived(tools.holding);
  const rendering = $derived(editor.rendering);
  const penSeen = $derived(editor.penSeen);
  const stampInfo = $derived(tools.stampInfo);
  const selectionInfo = $derived(editor.selectionInfo);
  let paintButton = $state<HTMLElement>();
  let setsButton = $state<HTMLElement>();
  let transformButton = $state<HTMLElement>();
  let booleanButton = $state<HTMLElement>();
  let arrangeButton = $state<HTMLElement>();
  let arrangeOpen = $state(false);
  let booleanOpen = $state(false);
  const BOOLEANS = ['scene.union', 'scene.subtract', 'scene.intersect', 'scene.split', 'scene.splitByColor', 'scene.unlink'];
  let mirrorButton = $state<HTMLElement>();
  let mirrorOpen = $state(false);
  /** Moves one mirror plane to a coordinate (a half step: between voxels or through one). */
  const setMirrorCenter = (axis: number, at: number) => {
    const center2 = [...$settings.mirror.center2] as [number, number, number];
    center2[axis] = Math.round(at * 2);
    set({ mirror: { ...$settings.mirror, center2 } });
  };
  let transformOpen = $state(false);
  const TRANSFORMS = [
    'region.rotateX',
    'region.rotateY',
    'region.rotateZ',
    'region.scale',
    'region.loop',
    'region.array',
    'region.crop',
  ];
  function runTransform(id: string): void {
    transformOpen = false;
    run(id);
  }
  let setsOpen = $state(false);
  let paintOpen = $state(false);
  /** Something other than plain colour is on: the button shows it. */
  const painting = $derived(
    $settings.paintPattern !== 'solid' || $settings.shade !== 'none' || $settings.colorLock.length > 0,
  );

  const DRAWING = new Set([
    'brush',
    'stamp',
    'face',
    'box',
    'line',
    'rect',
    'ellipse',
    'sphere',
    'cylinder',
    'sdf',
    'curve',
    'cone',
    'pyramid',
    'torus',
    'stairs',
    'arch',
  ]);
  const SIZED = new Set(['brush', 'line', 'sculpt', 'curve']);
  const SCULPT_MODES = Object.keys(SCULPT_TITLES) as SculptMode[];
  const FILL_MODES = Object.keys(FILL_TITLES) as FillMode[];
  const SDF_SHAPES = Object.keys(SDF_TITLES) as SdfShape[];
  const SOLID = new Set(['box', 'sphere', 'cylinder']);
  const SELECT = new Set(['select-rect', 'select-lasso', 'select-box', 'select-region']);

  const ACTIONS = [
    { value: 'add', label: 'Add' },
    { value: 'erase', label: 'Erase' },
    { value: 'paint', label: 'Paint' },
  ] as const;
  const BRUSH_MODES: { value: BrushMode; label: string }[] = [
    { value: 'volume', label: 'Volume' },
    { value: 'plane', label: 'Plane' },
    { value: 'surface', label: 'Surface' },
  ];
  const LOCKS = [
    { value: 'none', label: 'Stroke: free' },
    { value: 'plane', label: 'On the plane' },
    { value: 'x', label: 'Along X' },
    { value: 'y', label: 'Along Y' },
    { value: 'z', label: 'Along Z' },
  ] as const;
  const SELECT_MODES: { value: SelectMode; label: string; tip: string }[] = [
    { value: 'replace', label: 'New', tip: 'New selection' },
    { value: 'add', label: '+', tip: 'Add · or hold Shift' },
    { value: 'subtract', label: '−', tip: 'Subtract · or hold Alt' },
    { value: 'intersect', label: '∩', tip: 'Intersect · or Shift+Alt' },
  ];
  const REGIONS: { value: RegionMode; label: string }[] = [
    { value: 'volume', label: 'Volume' },
    { value: 'face', label: 'Face' },
    { value: 'color', label: 'Color' },
  ];

  function set(patch: Partial<ToolSettings>): void {
    tools.updateSettings(patch);
  }
  const run = (id: string) => editor.actions.run(id);
  const key = (id: string) => editor.actions.shortcut(id) ?? '';
  const title = (id: string) => editor.actions.get(id)?.title ?? id;
  const toolTitle = $derived(title(`tool.${$toolId}`));
</script>

{#snippet act(id: string, label: string, icon?: string)}
  <button
    type="button"
    class="btn"
    class:icon={!label}
    aria-label={label || title(id)}
    data-tip={title(id)}
    data-key={key(id)}
    onclick={() => run(id)}
  >
    {#if icon}<Icon name={icon} />{/if}{label}
  </button>
{/snippet}

{#snippet transformMenu()}
  <button
    type="button"
    class="btn"
    class:on={transformOpen}
    aria-haspopup="menu"
    aria-expanded={transformOpen}
    data-tip="Rotate by an angle, scale, loop, array, crop — the selection or the whole object"
    bind:this={transformButton}
    onclick={() => (transformOpen = !transformOpen)}>Transform ▾</button
  >
{/snippet}

<div class="ctx" role="toolbar" aria-label="Tool settings">
  {#if $rendering}
    {#await import('./RenderBar.svelte') then { default: RenderBar }}<RenderBar {editor} />{/await}
  {:else if $mode === 'scene'}
    <span class="mode">Scene</span>
    <span class="label">
      {$selected.length === 0 ? 'click an object' : `selected: ${$selected.length}`}
    </span>
    <span class="sep"></span>
    {@render act('object.turnYBack', '⟲')}
    {@render act('object.turnY', '⟳')}
    {@render act('object.flipX', '⇋')}
    <span class="sep"></span>
    {@render act('scene.duplicate', 'Copy')}
    {@render act('scene.linkedCopy', 'Linked')}
    {@render act('scene.cloth', 'Cloth')}
    <button
      type="button"
      class="btn"
      data-tip="A shape from code: the selected object's program or a new one"
      onclick={() => editor.openProgram()}>Program</button
    >
    {@render act('scene.group', 'Group')}
    {@render act('scene.ungroup', 'Ungroup')}
    {@render act('scene.delete', 'Delete')}
    <button
      type="button"
      class="btn"
      class:on={booleanOpen}
      aria-haspopup="menu"
      aria-expanded={booleanOpen}
      data-tip="Merge, subtract, intersect objects; split into parts"
      bind:this={booleanButton}
      onclick={() => (booleanOpen = !booleanOpen)}>Booleans ▾</button
    >
    <button
      type="button"
      class="btn"
      class:on={arrangeOpen}
      aria-haspopup="dialog"
      aria-expanded={arrangeOpen}
      data-tip="Align, put on the ground, object origin, position by numbers"
      bind:this={arrangeButton}
      onclick={() => (arrangeOpen = !arrangeOpen)}>Arrange ▾</button
    >
  {:else}
    <span class="tool"><Icon name={$toolId} />{toolTitle}</span>
    {#if DRAWING.has($toolId)}
      <span class="sep"></span>
      <div class="seg accent" role="radiogroup" aria-label="What the tool does">
        {#each ACTIONS as a (a.value)}
          <button
            type="button"
            role="radio"
            aria-checked={$settings.action === a.value}
            class:on={$settings.action === a.value}
            data-tip={title(`action.${a.value}`)}
            data-key={key(`action.${a.value}`)}
            onclick={() => set({ action: a.value })}>{a.label}</button
          >
        {/each}
      </div>
    {/if}
    {#if SIZED.has($toolId)}
      <span class="sep"></span>
      <div class="size" data-tip="Brush size" data-key="[ ]">
        <input
          type="range"
          min="1"
          max={MAX_BRUSH_SIZE}
          value={$settings.brushSize}
          aria-label="Brush size"
          oninput={(e) => set({ brushSize: Number(e.currentTarget.value) })}
        />
        <span class="num">
          <NumberField
            label="Brush size"
            value={$settings.brushSize}
            min={1}
            max={MAX_BRUSH_SIZE}
            reset={1}
            onChange={(v) => set({ brushSize: v })}
          />
        </span>
      </div>
      {#if $penSeen && $toolId === 'brush'}
        <button
          type="button"
          class="btn"
          class:on={$settings.pressureSize}
          aria-pressed={$settings.pressureSize}
          data-tip="Pen pressure changes the size: light is smaller, full force is the set size"
          onclick={() => set({ pressureSize: !$settings.pressureSize })}>Pressure</button
        >
      {/if}
      {#if $toolId !== 'sculpt' && $toolId !== 'curve'}
      <div class="seg" role="radiogroup" aria-label="Brush shape">
        <button
          type="button"
          role="radio"
          aria-checked={$settings.brushShape === 'cube'}
          class:on={$settings.brushShape === 'cube'}
          onclick={() => set({ brushShape: 'cube' })}>Cube</button
        >
        <button
          type="button"
          role="radio"
          aria-checked={$settings.brushShape === 'sphere'}
          class:on={$settings.brushShape === 'sphere'}
          onclick={() => set({ brushShape: 'sphere' })}>Ball</button
        >
      </div>
      {/if}
    {/if}
    {#if $toolId === 'sculpt'}
      <select
        class="select"
        aria-label="Where it grows"
        data-tip="Where to grow and where to take away from"
        value={$settings.sculptDirection}
        onchange={(e) => set({ sculptDirection: e.currentTarget.value as SculptDirection })}
      >
        <option value="normal">Along the normal</option>
        <option value="up">Up</option>
        <option value="all">All directions</option>
      </select>
      <button
        type="button"
        class="btn"
        class:on={$settings.sculptUseColor}
        aria-pressed={$settings.sculptUseColor}
        data-tip="New voxels get the current color, not the color of their neighbors"
        onclick={() => set({ sculptUseColor: !$settings.sculptUseColor })}>Current color</button
      >
    {/if}
    {#if $toolId === 'brush'}
      <select
        class="select"
        aria-label="Brush mode"
        data-tip="Brush mode"
        data-key={key('brush.mode')}
        value={$settings.brushMode}
        onchange={(e) => set({ brushMode: e.currentTarget.value as BrushMode })}
      >
        {#each BRUSH_MODES as m (m.value)}<option value={m.value}>{m.label}</option>{/each}
      </select>
      <select
        class="select"
        aria-label="Stroke lock"
        data-tip="Stroke lock: to a plane or an axis"
        value={$settings.lock}
        onchange={(e) => set({ lock: e.currentTarget.value as ToolSettings['lock'] })}
      >
        {#each LOCKS as l (l.value)}<option value={l.value}>{l.label}</option>{/each}
      </select>
    {/if}
    {#if $toolId === 'sculpt'}
      <span class="sep"></span>
      <div class="seg accent" role="radiogroup" aria-label="What the sculpt does">
        {#each SCULPT_MODES as m (m)}
          <button
            type="button"
            role="radio"
            aria-checked={$settings.sculptMode === m}
            class:on={$settings.sculptMode === m}
            onclick={() => set({ sculptMode: m })}>{SCULPT_TITLES[m]}</button
          >
        {/each}
      </div>
    {/if}
    {#if $toolId === 'stamp'}
      <span class="sep"></span>
      {@render act('stamp.fromSelection', 'Take from selection')}
      {#if $stampInfo}
        <span class="label" data-tip="What the stamp places">{$stampInfo.name} · {$stampInfo.size.join('×')}</span>
        {@render act('stamp.turnLeft', '⟲')}
        {@render act('stamp.turnRight', '⟳')}
        {@render act('stamp.flip', '⇋')}
        <div class="seg" role="radiogroup" aria-label="Stamp colors">
          <button
            type="button"
            role="radio"
            aria-checked={$settings.stampOwnColor}
            class:on={$settings.stampOwnColor}
            data-tip="The colors the taken voxels had"
            onclick={() => set({ stampOwnColor: true })}>Own colors</button
          >
          <button
            type="button"
            role="radio"
            aria-checked={!$settings.stampOwnColor}
            class:on={!$settings.stampOwnColor}
            data-tip="The whole stamp in the current color"
            onclick={() => set({ stampOwnColor: false })}>Current</button
          >
        </div>
        <button
          type="button"
          class="btn"
          class:on={$settings.stampAlign}
          aria-pressed={$settings.stampAlign}
          data-tip="The stamp follows the face normal: sideways on a wall, down on a ceiling"
          onclick={() => set({ stampAlign: !$settings.stampAlign })}>Follow face</button
        >
        <select
          class="select"
          aria-label="Stamp stroke"
          data-tip="How stamps land when you drag"
          value={$settings.stampSpacing}
          onchange={(e) => set({ stampSpacing: e.currentTarget.value as 'dense' | 'apart' })}
        >
          <option value="dense">Stroke: dense</option>
          <option value="apart">Stroke: spaced</option>
        </select>
      {/if}
    {/if}
    {#if $toolId === 'face'}
      <span class="sep"></span>
      <div class="seg" role="radiogroup" aria-label="Which face to take">
        <button
          type="button"
          role="radio"
          aria-checked={!$settings.faceByColor}
          class:on={!$settings.faceByColor}
          onclick={() => set({ faceByColor: false })}>Whole face</button
        >
        <button
          type="button"
          role="radio"
          aria-checked={$settings.faceByColor}
          class:on={$settings.faceByColor}
          data-tip={title('face.byColor')}
          data-key={key('face.byColor')}
          onclick={() => set({ faceByColor: true })}>One color</button
        >
      </div>
    {/if}
    {#if SOLID.has($toolId)}
      <span class="label hint">Ctrl — height</span>
    {/if}
    {#if $toolId === 'pipette'}
      <span class="label hint">Click a voxel to take its color</span>
    {/if}
    {#if $toolId === 'rope'}
      <span class="sep"></span>
      <div class="seg" role="radiogroup" aria-label="What to hang">
        {#each [['rope', 'Rope'], ['chain', 'Chain'], ['cable', 'Cable']] as const as [k, t] (k)}
          <button
            type="button"
            role="radio"
            aria-checked={$settings.ropeKind === k}
            class:on={$settings.ropeKind === k}
            onclick={() => set({ ropeKind: k })}>{t}</button
          >
        {/each}
      </div>
      <span class="label">Sag</span>
      <span class="num">
        <NumberField
          label="Sag"
          value={$settings.ropeSlack}
          min={1}
          max={3}
          step={0.05}
          decimals={2}
          reset={1.15}
          onChange={(v) => set({ ropeSlack: v })}
        />
      </span>
      <span class="label">Thickness</span>
      <span class="num">
        <NumberField
          label="Thickness"
          value={$settings.ropeThickness}
          min={1}
          max={16}
          reset={2}
          onChange={(v) => set({ ropeThickness: v })}
        />
      </span>
    {/if}
    {#if $toolId === 'curve'}
      <div class="seg" role="radiogroup" aria-label="Which curve">
        {#each Object.keys(CURVE_TITLES) as CurveMode[] as m (m)}
          <button
            type="button"
            role="radio"
            aria-checked={$settings.curveMode === m}
            class:on={$settings.curveMode === m}
            data-tip={m === 'arc' ? 'Drag from the start to the end: an arc, bend it afterwards' : 'Draw a line: it is smoothed into a spline'}
            onclick={() => set({ curveMode: m })}>{CURVE_TITLES[m]}</button
          >
        {/each}
      </div>
    {/if}
    {#if $toolId === 'sdf'}
      <span class="sep"></span>
      <div class="seg" role="radiogroup" aria-label="SDF shape">
        {#each SDF_SHAPES as s (s)}
          <button
            type="button"
            role="radio"
            aria-checked={$settings.sdfShape === s}
            class:on={$settings.sdfShape === s}
            data-tip={s === 'stroke' ? 'A tube along the stroke, as thick as the brush' : 'Size is the drag length'}
            onclick={() => set({ sdfShape: s })}>{SDF_TITLES[s]}</button
          >
        {/each}
      </div>
      {#if $settings.sdfShape === 'stroke'}
        <span class="num">
          <NumberField
            label="Stroke thickness"
            value={$settings.brushSize}
            min={1}
            max={MAX_BRUSH_SIZE}
            onChange={(v) => set({ brushSize: v })}
          />
        </span>
      {/if}
      <span class="label">Blend</span>
      <span class="num">
        <NumberField
          label="Shape blending, voxels"
          tip="How much the shapes melt into each other; 0 — simply together"
          value={$settings.sdfBlend}
          min={0}
          max={16}
          reset={4}
          onChange={(v) => set({ sdfBlend: v })}
        />
      </span>
    {/if}
    {#if $toolId === 'fill'}
      <span class="sep"></span>
      <div class="seg" role="radiogroup" aria-label="What to fill">
        {#each FILL_MODES as m (m)}
          <button
            type="button"
            role="radio"
            aria-checked={$settings.fillMode === m}
            class:on={$settings.fillMode === m}
            onclick={() => set({ fillMode: m })}>{FILL_TITLES[m]}</button
          >
        {/each}
      </div>
      <span class="sep"></span>
      {@render act('model.fillInterior', 'Inside')}
      {@render act('model.hollow', 'Hollow')}
      {@render act('model.removeHidden', 'Remove hidden')}
    {/if}
    {#if $toolId === 'replace'}
      <span class="label hint">Click a voxel — all voxels of its color take the current color</span>
    {/if}
    {#if SELECT.has($toolId)}
      <span class="sep"></span>
      <div class="seg" role="radiogroup" aria-label="How to select">
        {#each SELECT_MODES as m (m.value)}
          <button
            type="button"
            role="radio"
            aria-checked={$settings.selectMode === m.value}
            class:on={$settings.selectMode === m.value}
            data-tip={m.tip}
            onclick={() => set({ selectMode: m.value })}>{m.label}</button
          >
        {/each}
      </div>
      {#if $toolId === 'select-region'}
        <div class="seg" role="radiogroup" aria-label="What the wand selects">
          {#each REGIONS as r (r.value)}
            <button
              type="button"
              role="radio"
              aria-checked={$settings.regionMode === r.value}
              class:on={$settings.regionMode === r.value}
              onclick={() => set({ regionMode: r.value })}>{r.label}</button
            >
          {/each}
        </div>
      {/if}
      <span class="sep"></span>
      {@render act('select.all', 'All')}
      {@render act('select.none', 'None')}
      {@render act('select.invert', 'Invert')}
      {@render act('select.grow', 'Grow')}
      {@render act('select.shrink', 'Shrink')}
      <span class="sep"></span>
      <button
        type="button"
        class="btn"
        class:on={setsOpen}
        aria-haspopup="dialog"
        aria-expanded={setsOpen}
        data-tip="Saved selections"
        bind:this={setsButton}
        onclick={() => (setsOpen = !setsOpen)}>Sets ▾</button
      >
      {@render act('select.toObject', 'To object')}
      {@render act('scene.cloth', 'Cloth')}
      {@render transformMenu()}
    {/if}
    {#if $toolId === 'move'}
      <span class="sep"></span>
      {#if $holding}
        <button type="button" class="btn place" data-tip="Place the piece" data-key="Enter" onclick={() => tools.handleKey('Enter')}
          >Place</button
        >
        <button type="button" class="btn" data-tip="Drop the piece" data-key="Esc" onclick={() => tools.handleKey('Escape')}
          >Cancel</button
        >
        <span class="sep"></span>
      {/if}
      {@render act('piece.turnYBack', '⟲')}
      {@render act('piece.turnY', '⟳')}
      {@render act('piece.flipX', '⇋')}
      {@render act('piece.flipY', '⇅')}
      {@render act('edit.duplicate', 'Copy')}
      {@render transformMenu()}
    {/if}
    {#if (DRAWING.has($toolId) || $toolId === 'fill' || $toolId === 'sculpt') && ($selectionInfo || $settings.editMask !== 'all')}
      <select
        class="select"
        class:active={$settings.editMask !== 'all'}
        aria-label="Where to edit"
        data-tip="Edit everywhere, only inside the selection or only outside it"
        value={$settings.editMask}
        onchange={(e) => set({ editMask: e.currentTarget.value as EditMask })}
      >
        <option value="all">Edit everywhere</option>
        <option value="inside">Only inside the selection</option>
        <option value="outside">Only outside the selection</option>
      </select>
    {/if}
    {#if DRAWING.has($toolId) || $toolId === 'fill'}
      <button
        type="button"
        class="btn"
        class:on={paintOpen}
        class:active={painting}
        aria-haspopup="dialog"
        aria-expanded={paintOpen}
        data-tip="Pattern, tone and color lock"
        bind:this={paintButton}
        onclick={() => (paintOpen = !paintOpen)}>Paint{painting ? ' •' : ''} ▾</button
      >
    {/if}
    {#if DRAWING.has($toolId) || $toolId === 'sculpt'}
      <span class="sep"></span>
      <button
        type="button"
        class="btn icon mirror"
        class:on={mirrorOpen}
        aria-label="Where the mirror planes are"
        data-tip="Mirror: where its planes are — model center, selection center, by numbers"
        bind:this={mirrorButton}
        onclick={() => (mirrorOpen = !mirrorOpen)}
      >
        <Icon name="mirror" />
      </button>
      {#each ['x', 'y', 'z'] as const as axis (axis)}
        <button
          type="button"
          class="btn axis"
          class:on={$settings.mirror[axis]}
          aria-pressed={$settings.mirror[axis]}
          data-tip={title(`mirror.${axis}`)}
          data-key={key(`mirror.${axis}`)}
          onclick={() => run(`mirror.${axis}`)}>{axis.toUpperCase()}</button
        >
      {/each}
    {/if}
  {/if}
</div>

{#if arrangeOpen && arrangeButton}
  <Popover anchor={arrangeButton} label="Arrange" onClose={() => (arrangeOpen = false)}>
    {#await import('./ArrangeMenu.svelte') then { default: ArrangeMenu }}<ArrangeMenu {editor} />{/await}
  </Popover>
{/if}
{#if booleanOpen && booleanButton}
  <Popover anchor={booleanButton} label="Boolean operations" onClose={() => (booleanOpen = false)}>
    <div class="items" role="menu">
      {#each BOOLEANS as id (id)}
        <button
          type="button"
          role="menuitem"
          class="item"
          disabled={!editor.actions.isEnabled(editor.actions.get(id)!)}
          onclick={() => {
            booleanOpen = false;
            run(id);
          }}>{title(id)}</button
        >
      {/each}
      <p class="note">The target is the edited object (or the first selected one), the rest are the tools.</p>
    </div>
  </Popover>
{/if}
{#if mirrorOpen && mirrorButton}
  <Popover anchor={mirrorButton} label="Mirror" onClose={() => (mirrorOpen = false)}>
    <div class="items mirror-menu">
      <button type="button" class="item" onclick={() => run('mirror.center')}>At the model center</button>
      <button type="button" class="item" onclick={() => run('mirror.selection')}>At the selection center</button>
      <button type="button" class="item" onclick={() => run('mirror.origin')}>At the origin</button>
      <button type="button" class="item" onclick={() => run('mirror.keel')}>Through a voxel ↔ between voxels</button>
      <div class="planes">
        {#each ['X', 'Y', 'Z'] as name, i (name)}
          <label class="plane">
            <span>{name}</span>
            <NumberField
              label="Mirror plane {name}"
              value={$settings.mirror.center2[i]! / 2}
              step={0.5}
              decimals={1}
              onChange={(v) => setMirrorCenter(i, v)}
            />
          </label>
        {/each}
      </div>
      <p class="note">Planes are in object coordinates; .5 — through the middle of a voxel.</p>
    </div>
  </Popover>
{/if}
{#if transformOpen && transformButton}
  <Popover anchor={transformButton} label="Transform" onClose={() => (transformOpen = false)}>
    <div class="items" role="menu">
      {#each TRANSFORMS as id (id)}
        <button type="button" role="menuitem" class="item" onclick={() => runTransform(id)}>{title(id)}</button>
      {/each}
      <p class="note">The numbers can be changed afterwards in “Adjust”.</p>
    </div>
  </Popover>
{/if}
{#if setsOpen && setsButton}
  <Popover anchor={setsButton} label="Selection sets" onClose={() => (setsOpen = false)}>
    <SelectionSets {editor} />
  </Popover>
{/if}
{#if paintOpen && paintButton}
  <Popover anchor={paintButton} label="Paint" onClose={() => (paintOpen = false)}>
    {#await import('./PaintMenu.svelte') then { default: PaintMenu }}<PaintMenu {editor} />{/await}
  </Popover>
{/if}

<style>
  .ctx {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    min-width: 0;
    height: 40px;
    padding: 0 8px;
    overflow-x: auto;
    scrollbar-width: none;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .ctx::-webkit-scrollbar {
    display: none;
  }
  .tool {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    padding: 0 8px 0 4px;
    color: var(--text);
    font-weight: 600;
    white-space: nowrap;
  }
  .mode {
    flex: none;
    padding: 4px 10px;
    border-radius: var(--radius-s);
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }
  .label {
    padding: 0 4px;
  }
  .hint {
    padding: 0 8px;
  }
  .size {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    padding: 0 4px;
  }
  .mirror {
    display: inline-flex;
    padding: 0 2px 0 4px;
  }
  .size input[type='range'] {
    width: 64px;
    accent-color: var(--accent);
  }
  .num {
    flex: none;
    width: 44px;
  }
  .select {
    flex: none;
    height: calc(var(--control) - 2px);
    padding: 0 6px;
    border: 0;
    border-radius: var(--radius-s);
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
  }
  .select:focus-visible {
    outline: 2px solid var(--accent);
  }
  .axis {
    min-width: 26px;
    padding: 0;
    font-weight: 600;
  }
  .active {
    color: var(--accent);
  }
  .items {
    display: flex;
    flex-direction: column;
    min-width: 260px;
    padding: 4px;
  }
  .item {
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-s);
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .item:hover:not(:disabled) {
    background: var(--hover);
  }
  .item:disabled {
    color: var(--text-faint);
    cursor: default;
  }
  .mirror-menu {
    width: 300px;
  }
  .planes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    padding: 6px 10px 2px;
  }
  .plane {
    display: grid;
    gap: 2px;
    color: var(--text-dim);
    font-size: 11px;
  }
  .note {
    margin: 4px 10px 6px;
    color: var(--text-faint);
    font-size: 12px;
  }
  .place {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }
  .place:hover:not(:disabled) {
    background: var(--accent);
    color: var(--accent-text);
    filter: brightness(1.08);
  }
  @media (pointer: coarse) {
    .ctx {
      height: 52px;
    }
  }
</style>
