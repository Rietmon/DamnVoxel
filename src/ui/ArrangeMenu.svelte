<script lang="ts">
  import type { Editor } from '../app/editor';
  import { placeNode } from '../core/arrange';
  import { worldBounds } from '../core/scene-edit';
  import NumberField from './NumberField.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const sceneVersion = $derived(editor.sceneVersion);
  const selected = $derived(editor.selectedNodes);

  const AXES = ['X', 'Y', 'Z'] as const;
  const EDGES = [
    ['min', 'start'],
    ['center', 'middle'],
    ['max', 'end'],
  ] as const;
  const run = (id: string) => editor.actions.run(id);

  /** The node the numbers show: the first selected one. */
  const node = $derived($selected[0] ?? null);
  const box = $derived.by(() => {
    void $sceneVersion;
    return node ? worldBounds([node]) : null;
  });
</script>

<div class="menu">
  <section>
    <h3>Align to the edited object</h3>
    <div class="grid">
      <span></span>
      {#each EDGES as [, title] (title)}<span class="col">{title}</span>{/each}
      {#each AXES as axis (axis)}
        <span class="row">{axis}</span>
        {#each EDGES as [edge] (edge)}
          <button
            type="button"
            class="btn"
            data-tip="Align on {axis}: {edge === 'min' ? 'low edge' : edge === 'max' ? 'high edge' : 'middle'}"
            onclick={() => run(`scene.align.${axis.toLowerCase()}.${edge}`)}
            >{edge === 'min' ? '⇤' : edge === 'max' ? '⇥' : '↔'}</button
          >
        {/each}
      {/each}
    </div>
  </section>
  <section class="buttons">
    <button type="button" class="btn" data-key={editor.actions.shortcut('scene.ground') ?? ''} onclick={() => run('scene.ground')}
      >Put on the ground</button
    >
    <button type="button" class="btn" onclick={() => run('scene.origin.bottom')}>Origin at the bottom</button>
    <button type="button" class="btn" onclick={() => run('scene.origin.center')}>Origin at the center</button>
  </section>
  {#if node && box}
    <section>
      <h3>“{node.name}”: position of the box corner</h3>
      <div class="numbers">
        {#each AXES as axis, i (axis)}
          <label class="field">
            <span>{axis}</span>
            <NumberField
              label="Position {axis}"
              value={i === 0 ? box.minX : i === 1 ? box.minY : box.minZ}
              onChange={(v, live) => placeNode(editor.doc, node, i, v, live)}
              onEnd={() => editor.doc.history.closeMerge()}
            />
          </label>
        {/each}
      </div>
    </section>
  {/if}
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
    margin: 0;
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 500;
  }
  .grid {
    display: grid;
    grid-template-columns: 24px repeat(3, 1fr);
    gap: 4px;
    align-items: center;
  }
  .col,
  .row {
    color: var(--text-dim);
    font-size: 11px;
    text-align: center;
  }
  .buttons {
    flex-direction: row;
    flex-wrap: wrap;
  }
  .numbers {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .field {
    display: grid;
    gap: 2px;
    color: var(--text-dim);
    font-size: 11px;
  }
</style>
