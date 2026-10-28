<script lang="ts">
  import type { Editor } from '../app/editor';
  import { FACING_TITLES, type ReferenceFacing } from '../app/references';
  import Icon from './Icon.svelte';
  import NumberField from './NumberField.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();
  const references = $derived(editor.references);
  const FACINGS = Object.keys(FACING_TITLES) as ReferenceFacing[];
</script>

<div class="refs">
  {#each $references as r (r.id)}
    <article class="ref" class:hidden={!r.visible}>
      <header>
        <img src={r.thumb} alt="" />
        <span class="name" title={r.name}>{r.name}</span>
        <button
          type="button"
          class="btn icon"
          class:on={!r.visible}
          aria-pressed={!r.visible}
          aria-label={r.visible ? 'Hide' : 'Show'}
          data-tip={r.visible ? 'Hide' : 'Show'}
          onclick={() => editor.updateReference(r.id, { visible: !r.visible })}
        >
          <Icon name="eye" />
        </button>
        <button
          type="button"
          class="btn icon lock"
          class:on={r.locked}
          aria-pressed={r.locked}
          aria-label={r.locked ? 'Unlock' : 'Lock'}
          data-tip={r.locked ? 'Locked: settings do not change' : 'Lock the place and settings'}
          onclick={() => editor.updateReference(r.id, { locked: !r.locked })}>{r.locked ? '🔒' : '🔓'}</button
        >
        <button
          type="button"
          class="btn icon"
          aria-label="Remove reference"
          data-tip="Remove reference"
          onclick={() => editor.removeReference(r.id)}
        >
          <Icon name="close" />
        </button>
      </header>
      <fieldset disabled={r.locked}>
        <div class="seg wide" role="radiogroup" aria-label="Where to show">
          <button
            type="button"
            role="radio"
            aria-checked={r.mode === 'plane'}
            class:on={r.mode === 'plane'}
            data-tip="A plane in the scene: turns with the model"
            onclick={() => editor.updateReference(r.id, { mode: 'plane' })}>In scene</button
          >
          <button
            type="button"
            role="radio"
            aria-checked={r.mode === 'background'}
            class:on={r.mode === 'background'}
            data-tip="A background behind the model, filling the view"
            onclick={() => editor.updateReference(r.id, { mode: 'background' })}>Background</button
          >
        </div>
        <label class="row">
          <span>Opacity</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={r.opacity}
            oninput={(e) => editor.updateReference(r.id, { opacity: Number(e.currentTarget.value) })}
          />
        </label>
        {#if r.mode === 'plane'}
          <div class="seg wide" role="radiogroup" aria-label="Facing">
            {#each FACINGS as f (f)}
              <button
                type="button"
                role="radio"
                aria-checked={r.facing === f}
                class:on={r.facing === f}
                onclick={() => editor.updateReference(r.id, { facing: f })}>{FACING_TITLES[f]}</button
              >
            {/each}
          </div>
          <div class="numbers">
            {#each ['X', 'Y', 'Z'] as axis, i (axis)}
              <label class="field">
                <span>{axis}</span>
                <NumberField
                  label="Center, {axis}"
                  value={r.center[i]!}
                  step={0.5}
                  decimals={1}
                  onChange={(v) => {
                    const center: [number, number, number] = [...r.center];
                    center[i] = v;
                    editor.updateReference(r.id, { center });
                  }}
                />
              </label>
            {/each}
            <label class="field">
              <span>Width</span>
              <NumberField
                label="Width in voxels"
                value={r.size}
                min={1}
                step={0.5}
                decimals={1}
                onChange={(v) => editor.updateReference(r.id, { size: v })}
              />
            </label>
          </div>
        {/if}
      </fieldset>
    </article>
  {/each}
  <button type="button" class="btn add" onclick={() => editor.actions.run('file.addReference')}>
    <Icon name="add" />Add picture
  </button>
  {#if $references.length === 0}
    <p class="note">You can also just drag a picture into the window.</p>
  {/if}
</div>

<style>
  .refs {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 10px 12px;
  }
  .ref {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  .ref.hidden {
    opacity: 0.6;
  }
  header {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  img {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    object-fit: cover;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lock {
    font-size: 13px;
  }
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  fieldset:disabled {
    opacity: 0.55;
  }
  .wide {
    display: flex;
  }
  .wide > button {
    flex: 1;
  }
  .row {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 8px;
    color: var(--text-dim);
    font-size: 12px;
  }
  .row input {
    width: 100%;
    accent-color: var(--accent);
  }
  .numbers {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }
  .field {
    display: grid;
    gap: 2px;
    color: var(--text-dim);
    font-size: 11px;
  }
  .add {
    align-self: flex-start;
  }
  .note {
    margin: 0;
    color: var(--text-faint);
    font-size: 12px;
  }
</style>
