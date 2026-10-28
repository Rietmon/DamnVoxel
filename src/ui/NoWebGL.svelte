<script lang="ts">
  interface Props {
    reason: 'missing' | 'failed';
    detail: string;
  }
  const { reason, detail }: Props = $props();
</script>

<div class="screen">
  <div class="card" role="alert">
    <h1>3D cannot start</h1>
    {#if reason === 'missing'}
      <p>This browser does not support WebGL2, and without it the editor cannot draw models.</p>
      <ul>
        <li>Update the browser: Chrome, Edge and Firefox from the last two years and Safari 16 or newer work.</li>
      </ul>
    {:else}
      <p>The browser supports WebGL2 but did not let it turn on. Usually one of these helps:</p>
      <ul>
        <li>
          Turn on hardware acceleration. Chrome and Edge: Settings → System → “Use graphics
          acceleration when available”. Firefox: Settings → Performance.
        </li>
        <li>Update the graphics driver: the browser may have turned WebGL off for an old driver.</li>
        <li>Close other tabs with 3D and restart the browser.</li>
      </ul>
    {/if}
    <p class="hint">
      Details about the graphics card in Chrome and Edge are on the <code>chrome://gpu</code> page.
    </p>
    <details>
      <summary>Technical reason</summary>
      <code>{detail}</code>
    </details>
  </div>
</div>

<style>
  .screen {
    display: grid;
    place-items: center;
    min-height: 100dvh;
    padding: 16px;
  }
  .card {
    max-width: 520px;
    padding: 24px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
  }
  h1 {
    margin: 0 0 12px;
    font-size: 20px;
  }
  ul {
    padding-left: 20px;
  }
  li {
    margin: 6px 0;
  }
  .hint {
    color: var(--text-dim);
  }
  code {
    font-family: var(--mono);
    word-break: break-all;
  }
  details {
    margin-top: 12px;
    color: var(--text-dim);
  }
</style>
