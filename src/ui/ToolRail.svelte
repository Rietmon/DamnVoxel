<script lang="ts">
  import type { Editor } from '../app/editor';
  import { familyOf, familyTool, TOOL_FAMILIES, type ToolFamily } from '../app/tool-families';
  import { toHex } from '../core/color';
  import Icon from './Icon.svelte';

  interface Props {
    editor: Editor;
    /** Phone: one row along the bottom, lists open upwards. */
    row?: boolean;
    /** The colour swatch was pressed (opens the colour editor or the palette). */
    onColor?: (anchor: HTMLElement) => void;
  }
  const { editor, row = false, onColor }: Props = $props();
  const activeTool = $derived(editor.tools.activeToolId);
  const mode = $derived(editor.mode);
  const ui = $derived(editor.ui);
  const settings = $derived(editor.tools.settingsStore);
  const paletteVersion = $derived(editor.paletteVersion);

  let open = $state<string | null>(null);
  let rail = $state<HTMLElement>();
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressed = false;

  const colour = $derived.by(() => {
    void $paletteVersion;
    return toHex(editor.doc.palette.color($settings.color));
  });

  const title = (id: string) => editor.actions.get(`tool.${id}`)?.title ?? id;
  const key = (id: string) => editor.actions.shortcut(`tool.${id}`) ?? '';

  function pick(id: string): void {
    open = null;
    editor.actions.run(`tool.${id}`);
  }

  function press(family: ToolFamily): void {
    if (longPressed) {
      longPressed = false;
      return;
    }
    const current = familyOf($activeTool)?.id === family.id && $mode === 'model';
    // A second press on the active family opens its list; the first just takes the tool.
    if (current && family.tools.length > 1) open = open === family.id ? null : family.id;
    else pick(familyTool(family, $ui.lastTool));
  }

  function startLongPress(e: PointerEvent, family: ToolFamily): void {
    if (family.tools.length < 2 || e.button !== 0) return;
    pressTimer = setTimeout(() => {
      longPressed = true;
      open = family.id;
    }, 450);
  }

  function cancelLongPress(): void {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  }

  $effect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !rail?.contains(e.target as Node)) {
        open = null;
      }
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
    };
  });
</script>

<nav class="rail" class:row aria-label="Tools" bind:this={rail}>
  {#each TOOL_FAMILIES as family (family.id)}
    {@const tool = familyTool(family, $ui.lastTool)}
    {@const active = $mode === 'model' && familyOf($activeTool)?.id === family.id}
    {@const shown = active ? $activeTool : tool}
    <div class="slot">
      <button
        type="button"
        class="btn icon tool"
        class:on={active}
        aria-pressed={active}
        aria-haspopup={family.tools.length > 1 ? 'menu' : undefined}
        aria-expanded={family.tools.length > 1 ? open === family.id : undefined}
        aria-label={title(shown)}
        data-tip={family.tools.length > 1 ? `${title(shown)} — more: click again` : title(shown)}
        data-key={key(shown)}
        data-tip-side={row ? undefined : 'right'}
        onclick={() => press(family)}
        oncontextmenu={(e) => {
          if (family.tools.length < 2) return;
          e.preventDefault();
          open = family.id;
        }}
        onpointerdown={(e) => startLongPress(e, family)}
        onpointerup={cancelLongPress}
        onpointerleave={cancelLongPress}
      >
        <Icon name={shown} />
        {#if family.tools.length > 1}<span class="more" aria-hidden="true"></span>{/if}
      </button>
      {#if open === family.id}
        <div class="menu float" role="menu" aria-label={family.title}>
          <div class="menu-title">{family.title}</div>
          {#each family.tools as id (id)}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={$activeTool === id}
              class="item"
              class:on={$activeTool === id}
              onclick={() => pick(id)}
            >
              <Icon name={id} />
              <span class="name">{title(id)}</span>
              {#if key(id)}<kbd>{key(id)}</kbd>{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
  <span class="grow"></span>
  <button
    type="button"
    class="swatch-btn"
    aria-label="Color"
    data-tip="Color — open"
    data-tip-side={row ? undefined : 'right'}
    onclick={(e) => onColor?.(e.currentTarget)}
  >
    <span class="swatch" style:background={colour}></span>
  </button>
</nav>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 52px;
    padding: 8px 0;
    background: var(--surface);
  }
  .rail.row {
    flex-direction: row;
    width: auto;
    padding: 6px 8px;
    gap: 4px;
  }
  .grow {
    flex: 1;
  }
  .slot {
    position: relative;
  }
  .tool {
    position: relative;
    width: 38px;
    height: 38px;
  }
  .row .tool {
    width: 44px;
    height: 44px;
  }
  /* A corner mark: this button holds more tools. */
  .more {
    position: absolute;
    right: 4px;
    bottom: 4px;
    width: 0;
    height: 0;
    border-left: 4px solid transparent;
    border-bottom: 4px solid currentColor;
    opacity: 0.7;
  }
  .menu {
    position: absolute;
    top: -6px;
    left: calc(100% + 8px);
    z-index: 30;
    display: flex;
    flex-direction: column;
    min-width: 230px;
    padding: 4px;
  }
  /* On a phone the list rises from the bottom across the screen, like a sheet. */
  .row .menu {
    position: fixed;
    top: auto;
    left: 8px;
    right: 8px;
    bottom: calc(64px + env(safe-area-inset-bottom));
    min-width: 0;
  }
  .menu-title {
    padding: 6px 10px 4px;
    color: var(--text-faint);
    font-size: 12px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-s);
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .item:hover {
    background: var(--hover);
  }
  .item.on {
    color: var(--accent);
  }
  .item .name {
    flex: 1;
  }
  .row .item {
    height: 44px;
  }
  .swatch-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-s);
    background: none;
    cursor: pointer;
  }
  .swatch-btn:hover {
    background: var(--hover);
  }
  .swatch-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .swatch {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    box-shadow:
      0 0 0 2px var(--text),
      0 0 0 3px rgb(0 0 0 / 60%);
  }
  .row .swatch-btn {
    width: 44px;
    height: 44px;
  }
</style>
