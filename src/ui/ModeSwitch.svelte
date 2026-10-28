<script lang="ts">
  import type { Editor, EditorMode } from '../app/editor';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const mode = $derived(editor.mode);
  const rendering = $derived(editor.rendering);
  const key = $derived(editor.actions.shortcut('mode.toggle'));

  const MODES: { id: EditorMode; title: string; tip: string }[] = [
    { id: 'model', title: 'Model', tip: 'Edit the voxels of the selected object' },
    { id: 'scene', title: 'Scene', tip: 'Select, move and turn objects' },
  ];
</script>

<div class="switch" role="radiogroup" aria-label="Mode">
  {#each MODES as m (m.id)}
    <button
      type="button"
      role="radio"
      aria-checked={!$rendering && $mode === m.id}
      class:on={!$rendering && $mode === m.id}
      title={key ? `${m.tip} (${key} to switch)` : m.tip}
      onclick={() => {
        editor.setRendering(false);
        editor.setMode(m.id);
      }}
    >
      {m.title}
    </button>
  {/each}
  <button
    type="button"
    role="radio"
    aria-checked={$rendering}
    class:on={$rendering}
    title="Beautiful render: light, shadows, materials (the camera moves, editing is in the Model mode)"
    onclick={() => editor.setRendering(true)}
  >
    Render
  </button>
</div>

<style>
  .switch {
    display: flex;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--float);
  }
  button {
    min-width: 72px;
    height: 30px;
    white-space: nowrap;
    padding: 0 14px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--text-dim);
    font-weight: 600;
    cursor: pointer;
  }
  button:hover {
    color: var(--text);
  }
  button.on {
    background: var(--accent);
    color: var(--accent-text);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  @media (pointer: coarse) {
    button {
      height: 38px;
    }
  }
  @media (max-width: 600px) {
    button {
      min-width: 0;
      padding: 0 12px;
    }
  }
</style>
