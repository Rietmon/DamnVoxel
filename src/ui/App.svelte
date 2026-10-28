<script lang="ts">
  import type { BenchResult } from '../app/bench';
  import type { Editor } from '../app/editor';
  import type { Readable } from '../app/store';
  import AdjustPanel from './AdjustPanel.svelte';
  import ContextBar from './ContextBar.svelte';
  import Dock, { type Section } from './Dock.svelte';
  import Icon from './Icon.svelte';
  import Popover from './Popover.svelte';
  import RecoveryBanner from './RecoveryBanner.svelte';
  import RenderJob from './RenderJob.svelte';
  import RenderWindow from './RenderWindow.svelte';
  import RulerLabels from './RulerLabels.svelte';
  import ScreenOverlay from './ScreenOverlay.svelte';
  import SelectionLabel from './SelectionLabel.svelte';
  import StatusBar from './StatusBar.svelte';
  import Toast from './Toast.svelte';
  import ToolRail from './ToolRail.svelte';
  import Tooltip from './Tooltip.svelte';
  import TopBar from './TopBar.svelte';
  import UpdateBanner from './UpdateBanner.svelte';
  import ViewCube from './ViewCube.svelte';
  import Viewport from './Viewport.svelte';

  interface Props {
    editor: Editor;
    /** Set when a new version is installed; calling it restarts into that version. */
    update: Readable<(() => void) | null>;
    /** Results of the ?bench run, when it is running. */
    bench?: Readable<BenchResult | null> | null;
  }
  const { editor, update, bench = null }: Props = $props();
  const showStats = $derived(editor.showStats);
  const commandsOpen = $derived(editor.commandsOpen);
  const radial = $derived(editor.radial);
  const lastRope = $derived(editor.lastRope);
  const contextLost = $derived(editor.contextLost);
  const settings = $derived(editor.tools.settingsStore);
  const docName = $derived(editor.docName);
  const modified = $derived(editor.modified);
  const ui = $derived(editor.ui);
  const mode = $derived(editor.mode);
  const rendering = $derived(editor.rendering);
  // Windows load the first time they open: the first launch stays small (docs/stack.md).
  const keymapOpen = $derived(editor.keymapOpen);
  const versionsOpen = $derived(editor.versionsOpen);
  const exportOpen = $derived(editor.exportOpen);
  const picturesOpen = $derived(editor.picturesOpen);
  const meshImportFiles = $derived(editor.meshImportFiles);
  const examplesOpen = $derived(editor.examplesOpen);
  const programOpen = $derived(editor.programOpen);
  // Bars show shortcuts in their tooltips: they are rebuilt when the layout changes.
  const keymap = $derived(editor.keymap);

  // The tab says what is open and whether it is saved.
  $effect(() => {
    document.title = `${$modified ? '• ' : ''}${$docName} — DamnVoxel`;
  });

  /** A phone or a narrow window: tools at the bottom, panels as sheets. */
  const narrowQuery = typeof matchMedia === 'function' ? matchMedia('(max-width: 700px)') : null;
  let narrow = $state(narrowQuery?.matches ?? false);
  $effect(() => {
    const onChange = () => {
      narrow = narrowQuery?.matches ?? false;
    };
    narrowQuery?.addEventListener('change', onChange);
    return () => narrowQuery?.removeEventListener('change', onChange);
  });

  let sheet = $state<Section | null>(null);
  let colorAnchor = $state<HTMLElement | null>(null);
  const toggleSheet = (s: Section) => {
    sheet = sheet === s ? null : s;
  };
  const editColor = (anchor: HTMLElement) => {
    colorAnchor = colorAnchor === anchor ? null : anchor;
  };
</script>

<div class="app" class:narrow class:bare={$ui.hidden}>
  {#if !$ui.hidden}
    {#key $keymap}<TopBar {editor} compact={narrow} />{/key}
  {/if}
  <div class="body">
    {#if !narrow && !$ui.hidden}
      {#key $keymap}<ToolRail {editor} onColor={editColor} />{/key}
    {/if}
    <div class="center">
    {#if !$ui.hidden}
      {#key $keymap}<ContextBar {editor} />{/key}
    {/if}
    <main class="view" class:scene={$mode === 'scene'}>
      <Viewport {editor} />
      {#if !$rendering}<RulerLabels {editor} />{/if}
      {#if !$ui.hidden}<RenderWindow {editor} /><RenderJob {editor} />{/if}
      {#if $programOpen && !$ui.hidden}
        {#await import('./ProgramPanel.svelte') then { default: ProgramPanel }}<ProgramPanel {editor} />{/await}
      {/if}
      <ScreenOverlay {editor} />
      <SelectionLabel {editor} />
      <ViewCube {editor} />
      <Toast {editor} />
      {#if $radial}
        {#await import('./RadialMenu.svelte') then { default: RadialMenu }}<RadialMenu {editor} />{/await}
      {/if}
      {#if !$ui.hidden}<AdjustPanel {editor} />{/if}
      {#if !$ui.hidden && $lastRope}
        {#await import('./RopePanel.svelte') then { default: RopePanel }}<RopePanel {editor} />{/await}
      {/if}
      {#if bench}
        {#await import('./BenchPanel.svelte') then { default: BenchPanel }}<BenchPanel result={bench} />{/await}
      {/if}
      {#if $contextLost}
        <div class="notice" role="status">The graphics card reset 3D. Restoring the picture, the model is safe…</div>
      {/if}
      {#if $showStats}
        {#await import('./StatsOverlay.svelte') then { default: StatsOverlay }}<StatsOverlay {editor} />{/await}
      {/if}
      {#if narrow && !$ui.hidden}
        <Dock {editor} {sheet} onSheet={(s) => (sheet = s)} onEditColor={editColor} />
      {/if}
      {#if $ui.hidden}
        <button
          type="button"
          class="btn show float"
          data-tip="Show interface"
          data-key={editor.actions.shortcut('ui.hide') ?? ''}
          onclick={() => editor.toggleInterface()}
        >
          <Icon name="panels" />Show interface
        </button>
      {/if}
    </main>
    {#if $ui.timeline && !$ui.hidden}{#await import('./Timeline.svelte') then { default: Timeline }}<Timeline {editor} />{/await}{/if}
    </div>
    {#if !narrow && !$ui.hidden}
      <Dock {editor} onEditColor={editColor} />
    {/if}
  </div>
  {#if !narrow && !$ui.hidden}
    <StatusBar {editor} />
  {/if}
  {#if narrow && !$ui.hidden}
    <div class="bottom">
      {#key $keymap}<ToolRail {editor} row onColor={() => toggleSheet('palette')} />{/key}
      <button
        type="button"
        class="btn icon panels"
        class:on={sheet === 'scene' || sheet === 'view'}
        aria-label="Scene and view"
        onclick={() => toggleSheet('scene')}
      >
        <Icon name="scene" />
      </button>
    </div>
  {/if}
</div>
{#if colorAnchor}
  <Popover
    anchor={colorAnchor}
    placement={narrow ? 'below' : 'right'}
    label="Color"
    onClose={() => (colorAnchor = null)}
  >
    <div class="color">
      {#await Promise.all([import('./ColorEditor.svelte'), import('./MaterialEditor.svelte')]) then [{ default: ColorEditor }, { default: MaterialEditor }]}
        <ColorEditor {editor} id={$settings.color} />
        <MaterialEditor {editor} id={$settings.color} />
      {/await}
    </div>
  </Popover>
{/if}
{#if $commandsOpen}
  {#await import('./CommandPalette.svelte') then { default: CommandPalette }}<CommandPalette {editor} />{/await}
{/if}
{#if $keymapOpen}
  {#await import('./KeymapDialog.svelte') then { default: KeymapDialog }}<KeymapDialog {editor} />{/await}
{/if}
{#if $versionsOpen}
  {#await import('./VersionsDialog.svelte') then { default: VersionsDialog }}<VersionsDialog {editor} />{/await}
{/if}
{#if $exportOpen}
  {#await import('./ExportDialog.svelte') then { default: ExportDialog }}<ExportDialog {editor} />{/await}
{/if}
{#if $picturesOpen}
  {#await import('./PicturesDialog.svelte') then { default: PicturesDialog }}<PicturesDialog {editor} />{/await}
{/if}
{#if $meshImportFiles}
  {#await import('./MeshImportDialog.svelte') then { default: MeshImportDialog }}<MeshImportDialog {editor} />{/await}
{/if}
{#if $examplesOpen}
  {#await import('./ExamplesDialog.svelte') then { default: ExamplesDialog }}<ExamplesDialog {editor} />{/await}
{/if}
<RecoveryBanner />
<Tooltip />
{#if $update}
  <UpdateBanner onApply={$update} />
{/if}

<style>
  /* Bars stacked around the body, whichever of them are shown. */
  .app {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .center {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  /* On a phone the tool settings sit under the view, next to the thumb; the rail below already
     shows which tool it is. */
  .narrow .center :global(.ctx) {
    order: 1;
    border-top: 1px solid var(--line);
    border-bottom: 0;
  }
  .narrow .center :global(.ctx .tool),
  .narrow .center :global(.ctx .tool + .sep) {
    display: none;
  }
  .view {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  /* Scene mode is marked twice: this frame and the word “Scene” in the context bar. */
  .view.scene::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 3;
    border: 2px solid var(--accent);
    pointer-events: none;
  }
  .notice {
    position: absolute;
    top: 50%;
    left: 50%;
    translate: -50% -50%;
    max-width: calc(100% - 32px);
    padding: 10px 14px;
    border-radius: var(--radius);
    background: var(--surface);
    text-align: center;
  }
  .show {
    position: absolute;
    left: 12px;
    bottom: 12px;
    z-index: 5;
    padding: 0 12px;
    color: var(--text);
  }
  .bottom {
    display: flex;
    align-items: center;
    min-width: 0;
    padding-right: 8px;
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--surface);
    border-top: 1px solid var(--line);
  }
  .bottom :global(.rail) {
    flex: 1;
    min-width: 0;
  }
  .panels {
    width: 44px;
    height: 44px;
  }
  .color {
    width: 288px;
  }
</style>
