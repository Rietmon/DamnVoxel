<script lang="ts">
  import type { Editor } from '../app/editor';
  import { toHex } from '../core/color';
  import Icon from './Icon.svelte';
  import NumberField from './NumberField.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const adjustment = $derived(editor.tools.adjustment);
  let open = $state(true);
</script>

{#if $adjustment}
  <section class="adjust float" aria-label="Adjust last operation">
    <button type="button" class="head" aria-expanded={open} onclick={() => (open = !open)}>
      <svg class="chev" class:folded={!open} viewBox="0 0 20 20" aria-hidden="true"><path d="M6 8 L10 12 L14 8" /></svg>
      Adjust: {$adjustment.title}
    </button>
    {#if open}
      <div class="fields">
        {#each $adjustment.fields as f (f.key)}
          <label class="field">
            <span>{f.label}</span>
            {#if f.key === 'color'}
              <span class="color">
                <span
                  class="swatch"
                  style:background={toHex(editor.doc.palette.color($adjustment.values.color!))}
                ></span>
                <NumberField
                  label={f.label}
                  value={$adjustment.values[f.key]!}
                  min={f.min}
                  max={f.max}
                  onChange={(v) => editor.tools.adjust(f.key, v)}
                />
              </span>
            {:else}
              <NumberField
                label={f.label}
                value={$adjustment.values[f.key]!}
                min={f.min}
                max={f.max}
                step={f.step}
                decimals={f.decimals}
                onChange={(v) => editor.tools.adjust(f.key, v)}
              />
            {/if}
          </label>
        {/each}
      </div>
      {#if $adjustment.fields.some((f) => f.key === 'color')}
        <button
          type="button"
          class="btn take"
          data-tip="Take the current brush color"
          onclick={() => editor.tools.adjust('color', editor.tools.settings.color)}
        >
          <Icon name="paint" />Current color
        </button>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .adjust {
    position: absolute;
    left: 12px;
    bottom: 12px;
    z-index: 4;
    width: 248px;
    padding: 4px 8px 8px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 30px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  .chev {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    transition: rotate 0.15s;
  }
  .chev.folded {
    rotate: -90deg;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px 6px;
  }
  .field {
    display: grid;
    gap: 2px;
    min-width: 0;
    color: var(--text-dim);
    font-size: 11px;
  }
  .color {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .swatch {
    flex: none;
    width: 14px;
    height: 14px;
    border-radius: 3px;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 25%);
  }
  .take {
    margin-top: 6px;
  }
</style>
