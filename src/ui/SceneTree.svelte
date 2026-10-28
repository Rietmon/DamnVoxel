<script lang="ts">
  import type { Editor } from '../app/editor';
  import { type DropTarget, dropTarget, rowRange, treeRows } from '../app/scene-tree';
  import type { SceneNode } from '../core/scene';
  import { moveNodes } from '../core/scene-edit';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const version = $derived(editor.sceneVersion);
  const selected = $derived(editor.selectedNodes);
  const active = $derived(editor.activeObject);

  /** Phones start with the panel folded: the model needs the screen more. */
  let collapsed = $state(new Set<number>());
  let editing = $state<number | null>(null);
  // Raw: a deep proxy would wrap the scene nodes it holds, and the drop would edit the copies.
  let drop = $state.raw<DropTarget | null>(null);
  let list = $state<HTMLElement>();
  /** Shift-click selects from here. */
  let anchor: SceneNode | null = null;

  /** Volumes shared by more than one object: linked copies. */
  const linked = $derived.by(() => {
    void $version;
    const seen = new Set<unknown>();
    const shared = new Set<unknown>();
    for (const o of editor.doc.scene.objects()) {
      if (seen.has(o.volume)) shared.add(o.volume);
      seen.add(o.volume);
    }
    return shared;
  });
  const rows = $derived.by(() => {
    void $version;
    return treeRows(editor.doc.scene.root, collapsed);
  });

  function toggleGroup(node: SceneNode): void {
    const next = new Set(collapsed);
    if (next.has(node.id)) next.delete(node.id);
    else next.add(node.id);
    collapsed = next;
  }

  function select(e: PointerEvent | KeyboardEvent, node: SceneNode): void {
    const current = editor.selectedNodes.get();
    if (e.ctrlKey || e.metaKey) {
      editor.selectNodes(
        current.includes(node) ? current.filter((n) => n !== node) : [...current, node],
      );
      anchor = node;
    } else if (e.shiftKey && anchor) {
      editor.selectNodes(rowRange(rows, anchor, node));
    } else {
      editor.selectNodes([node]);
      anchor = node;
    }
  }

  // Dragging rows: the mouse drags a row from anywhere on it, a finger only by the grip, so
  // the list still scrolls under a finger.
  let drag: {
    node: SceneNode;
    nodes: SceneNode[];
    x: number;
    y: number;
    moved: boolean;
  } | null = null;

  function onRowDown(e: PointerEvent, node: SceneNode, grip: boolean): void {
    if (e.button !== 0 || editing !== null) return;
    if (e.pointerType === 'touch' && !grip) return;
    const current = editor.selectedNodes.get();
    drag = {
      node,
      nodes: current.includes(node) ? current : [node],
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
  }

  function onListMove(e: PointerEvent): void {
    if (!drag || !list) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      // Captured only once it is a drag: a plain click still reaches the row (double click).
      list.setPointerCapture(e.pointerId);
    }
    const rect = list.getBoundingClientRect();
    // Near the edges the list scrolls by itself.
    if (e.clientY < rect.top + 20) list.scrollTop -= 8;
    else if (e.clientY > rect.bottom - 20) list.scrollTop += 8;
    const rowHeight = list.querySelector<HTMLElement>('.row')?.offsetHeight ?? 28;
    const y = e.clientY - rect.top + list.scrollTop;
    const index = Math.max(0, Math.floor(y / rowHeight));
    drop = dropTarget(rows, editor.doc.scene.root, index, (y / rowHeight) % 1, drag.nodes);
  }

  function onListUp(e: PointerEvent): void {
    const d = drag;
    drag = null;
    if (!d) return;
    if (!d.moved) select(e, d.node);
    else if (drop) {
      moveNodes(editor.doc, d.nodes, drop.parent, drop.before);
      // Dropped into a folded group: open it so the nodes stay in sight.
      if (drop.place === 'inside' && collapsed.has(drop.parent.id)) toggleGroup(drop.parent);
    }
    drop = null;
  }

  function onListCancel(): void {
    drag = null;
    drop = null;
  }

  function startRename(node: SceneNode): void {
    editing = node.id;
  }

  function finishRename(node: SceneNode, input: HTMLInputElement, keep: boolean): void {
    if (editing !== node.id) return;
    editing = null;
    const name = input.value.trim();
    if (keep && name) editor.setNodeProperty(node, 'name', name);
  }

  function focusInput(input: HTMLInputElement): void {
    input.focus();
    input.select();
  }

  /** Double click: on the name renames, elsewhere on the row shows the node in the view. */
  function onRowDouble(e: MouseEvent, node: SceneNode): void {
    const target = e.target as Element;
    if (target.closest('button, input')) return;
    if (target.closest('.name')) startRename(node);
    else editor.focusNode(node);
  }

  function onRowKey(e: KeyboardEvent, node: SceneNode): void {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(e, node);
    } else if (e.key === 'F2') {
      e.preventDefault();
      startRename(node);
    }
  }

  const tip = (title: string, id: string) => {
    const key = editor.actions.shortcut(id);
    return key ? `${title} (${key})` : title;
  };
</script>

<section class="tree" aria-label="Scene tree">
  <header>
    <button
      type="button"
      data-tip={tip('New object', 'scene.newObject')}
      onclick={() => editor.actions.run('scene.newObject')}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4 V16 M4 10 H16" /></svg>
      Object
    </button>
    <button
      type="button"
      data-tip={tip('Group', 'scene.group')}
      onclick={() => editor.actions.run('scene.group')}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M3 6 V15 H17 V8 H9 L7.5 6 Z" />
      </svg>
      Group
    </button>
    <button
      type="button"
      class="end"
      data-tip={tip('Delete object', 'scene.delete')}
      aria-label="Delete"
      onclick={() => editor.actions.run('scene.delete')}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M4 6 H16 M8 6 V4 H12 V6 M6 6 L7 16 H13 L14 6" />
      </svg>
    </button>
  </header>
    <div
      class="rows"
      role="tree"
      tabindex="-1"
      aria-multiselectable="true"
      bind:this={list}
      onpointermove={onListMove}
      onpointerup={onListUp}
      onpointercancel={onListCancel}
    >
      {#each rows as row, i (row.node.id)}
        {@const node = row.node}
        <div
          class="row"
          class:selected={$selected.includes(node)}
          class:active={$active === node}
          class:hidden={node.hidden}
          class:drop-above={drop?.row === i && drop.place === 'above'}
          class:drop-below={drop?.row === i && drop.place === 'below'}
          class:drop-inside={drop?.row === i && drop.place === 'inside'}
          style:--depth={row.depth}
          role="treeitem"
          tabindex="0"
          aria-level={row.depth + 1}
          aria-selected={$selected.includes(node)}
          aria-expanded={node.kind === 'group' ? row.expanded : undefined}
          onpointerdown={(e) => onRowDown(e, node, false)}
          onkeydown={(e) => onRowKey(e, node)}
          ondblclick={(e) => onRowDouble(e, node)}
        >
          <span
            class="grip"
            aria-hidden="true"
            onpointerdown={(e) => {
              e.stopPropagation();
              onRowDown(e, node, true);
            }}
          >
            <svg viewBox="0 0 20 20"><path d="M7 5 h.01 M13 5 h.01 M7 10 h.01 M13 10 h.01 M7 15 h.01 M13 15 h.01" /></svg>
          </span>
          {#if node.kind === 'group'}
            <button
              type="button"
              class="chevron"
              class:shut={!row.expanded}
              aria-label={row.expanded ? 'Collapse group' : 'Expand group'}
              onpointerdown={(e) => e.stopPropagation()}
              onclick={() => toggleGroup(node)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 8 L10 12 L14 8" /></svg>
            </button>
          {:else}
            <span class="kind" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <path d="M10 3 L16 6.5 V13.5 L10 17 L4 13.5 V6.5 Z M4 6.5 L10 10 L16 6.5 M10 10 V17" />
              </svg>
            </span>
          {/if}
          {#if editing === node.id}
            <input
              class="name"
              value={node.name}
              aria-label="Name"
              use:focusInput
              onpointerdown={(e) => e.stopPropagation()}
              onkeydown={(e) => {
                if (e.key === 'Enter') finishRename(node, e.currentTarget, true);
                else if (e.key === 'Escape') finishRename(node, e.currentTarget, false);
                e.stopPropagation();
              }}
              onblur={(e) => finishRename(node, e.currentTarget, true)}
            />
          {:else}
            <span class="name" data-tip="Double-click to rename">{node.name}</span>
            {#if node.kind === 'object' && linked.has(node.volume)}
              <span class="link" data-tip="Linked copy: voxels shared with other objects">∞</span>
            {/if}
          {/if}
          <span class="tools">
            <button
              type="button"
              class="focus"
              aria-label="Show in the view"
              data-tip="Show in the view"
              onpointerdown={(e) => e.stopPropagation()}
              onclick={() => editor.focusNode(node)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M10 3 V6 M10 14 V17 M3 10 H6 M14 10 H17 M10 7 a3 3 0 1 0 .01 0" />
              </svg>
            </button>
            <button
              type="button"
              class:off={node.hidden}
              aria-pressed={node.hidden}
              data-tip={node.hidden ? 'Show' : 'Hide'}
              onpointerdown={(e) => e.stopPropagation()}
              onclick={() => editor.setNodeProperty(node, 'hidden', !node.hidden)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                {#if node.hidden}
                  <path d="M3 10 C6 5 14 5 17 10 C14 15 6 15 3 10 Z M4 4 L16 16" />
                {:else}
                  <path d="M3 10 C6 5 14 5 17 10 C14 15 6 15 3 10 Z M10 8 a2 2 0 1 0 .01 0" />
                {/if}
              </svg>
            </button>
            <button
              type="button"
              class:on={node.locked}
              aria-pressed={node.locked}
              data-tip={node.locked ? 'Unlock' : 'Lock'}
              onpointerdown={(e) => e.stopPropagation()}
              onclick={() => editor.setNodeProperty(node, 'locked', !node.locked)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                {#if node.locked}
                  <path d="M5 9 H15 V16 H5 Z M7 9 V6.5 a3 3 0 0 1 6 0 V9" />
                {:else}
                  <path d="M5 9 H15 V16 H5 Z M7 9 V6.5 a3 3 0 0 1 5.8 -1" />
                {/if}
              </svg>
            </button>
          </span>
        </div>
      {/each}
      {#if rows.length === 0}
        <p class="empty">The scene is empty. Add an object with the “+” button.</p>
      {/if}
      <div class="tail" class:drop-below={drop?.row === rows.length - 1 && !rows.length}></div>
    </div>
</section>

<style>
  .link {
    color: var(--accent);
    font-size: 12px;
  }
  .tree {
    display: flex;
    flex-direction: column;
    min-height: 0;
    user-select: none;
    -webkit-user-select: none;
  }
  header {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 6px;
  }
  header button {
    padding: 0 8px;
    font-size: 13px;
  }
  header .end {
    margin-left: auto;
    padding: 0 4px;
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 28px;
    height: 28px;
    padding: 0 4px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text-dim);
    cursor: pointer;
  }
  button:hover {
    background: var(--panel-raised);
    color: var(--text);
  }
  button:focus-visible,
  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .rows {
    position: relative;
    overflow-y: auto;
    padding: 4px 0;
    overscroll-behavior: contain;
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    height: 30px;
    padding-left: calc(var(--depth) * 14px);
    padding-right: 4px;
    color: var(--text);
    cursor: default;
  }
  .row:hover {
    background: rgb(255 255 255 / 4%);
  }
  .row.selected {
    background: rgb(255 159 67 / 16%);
  }
  .row.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 5px;
    bottom: 5px;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  .row.hidden .name,
  .row.hidden .kind {
    opacity: 0.45;
  }
  .row.drop-above {
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .row.drop-below {
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .row.drop-inside {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .grip {
    display: inline-flex;
    width: 18px;
    height: 100%;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    opacity: 0.5;
    cursor: grab;
    touch-action: none;
  }
  .grip svg {
    width: 14px;
    stroke-width: 2.6;
  }
  .chevron,
  .kind {
    min-width: 22px;
    width: 22px;
    height: 22px;
    padding: 0;
    color: var(--text-dim);
  }
  .kind {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .kind svg,
  .chevron svg {
    width: 15px;
    height: 15px;
  }
  .chevron.shut svg {
    rotate: -90deg;
  }
  .name {
    flex: 1;
    min-width: 0;
    margin-left: 4px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  input.name {
    height: 24px;
    padding: 0 4px;
    border: 1px solid var(--accent);
    border-radius: 4px;
    background: var(--bg);
    user-select: text;
    -webkit-user-select: text;
  }
  .tools {
    display: inline-flex;
  }
  .tools button {
    min-width: 26px;
    height: 26px;
    padding: 0;
  }
  .tools svg {
    width: 16px;
    height: 16px;
  }
  /* Focus and an unchanged eye or lock show on hover; a hidden or locked node always shows. */
  .tools button:not(.off):not(.on) {
    opacity: 0;
  }
  .row:hover .tools button,
  .row:focus-within .tools button {
    opacity: 1;
  }
  .tools .on {
    color: var(--accent);
  }
  .empty {
    margin: 8px 12px;
    color: var(--text-dim);
    font-size: 13px;
  }
  .tail {
    height: 12px;
  }
  @media (pointer: coarse) {
    .row {
      height: 40px;
    }
    .grip {
      width: 28px;
      opacity: 0.8;
    }
    .tools button {
      min-width: 34px;
      height: 34px;
      opacity: 1;
    }
    .tools button:not(.off):not(.on) {
      opacity: 0.6;
    }
  }
</style>
