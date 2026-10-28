<script lang="ts">
  import type { Editor } from '../app/editor';
  import { modifierHints } from '../app/modifier-hints';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const hint = $derived(editor.tools.hintText);
  const hover = $derived(editor.hover);
  const settings = $derived(editor.tools.settingsStore);
  const toolId = $derived(editor.tools.activeToolId);
  const selection = $derived(editor.selectionInfo);
  const mode = $derived(editor.mode);
  const held = $derived(editor.heldModifiers);
  const hints = $derived(modifierHints($mode, $toolId));
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const KEY_NAMES = isMac
    ? { shift: '⇧', ctrl: '⌘', alt: '⌥' }
    : { shift: 'Shift', ctrl: 'Ctrl', alt: 'Alt' };

  const SCENE_HINT =
    'Click to select an object (Shift — add) · drag to move · double-click to edit the model · Q / E — turn';
  const BRUSHLIKE = new Set(['brush', 'line']);
</script>

<footer class="status">
  <span class="hint" title={$mode === 'scene' ? SCENE_HINT : ($hint ?? '')}>
    {$mode === 'scene' ? SCENE_HINT : ($hint ?? '')}
  </span>
  {#if hints.length > 0}
    <span class="mods" aria-label="Modifier keys">
      {#each hints as h (h.text + h.keys.join())}
        {@const on = h.keys.every((k) => $held[k])}
        <span class="mod" class:on>
          <kbd>{h.keys.map((k) => KEY_NAMES[k]).join('+')}</kbd>
          {h.text}
        </span>
      {/each}
    </span>
  {/if}
  {#if $mode === 'model' && $hover}
    <span class="cell" title="The voxel under the cursor, in object coordinates">
      {#if $hover.onPlane}
        floor · {$hover.x} {$hover.z}
      {:else}
        {$hover.x} {$hover.y} {$hover.z}
      {/if}
    </span>
  {/if}
  {#if $mode === 'model' && BRUSHLIKE.has($toolId)}
    <span title="Brush size, [ and ] — smaller and larger">brush {$settings.brushSize}</span>
  {/if}
  {#if $selection}
    <span title="Selected voxels, selection size">
      selected {$selection.count.toLocaleString('en-US')} · {$selection.size.join('×')}
    </span>
  {/if}
</footer>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
    height: 26px;
    padding: 0 10px;
    border-top: 1px solid var(--border);
    background: var(--panel);
    color: var(--text-dim);
    font-size: 12px;
    white-space: nowrap;
  }
  .hint {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cell {
    font-family: var(--mono);
  }
  .mods {
    display: flex;
    gap: 10px;
  }
  .mod.on {
    color: var(--accent);
  }
  kbd {
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg);
    font: 11px var(--mono);
  }
  .mod.on kbd {
    border-color: var(--accent);
  }
  @media (max-width: 1000px) {
    .mods {
      display: none;
    }
  }
</style>
