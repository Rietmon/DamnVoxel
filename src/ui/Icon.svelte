<script lang="ts">
  import { ICONS } from './icons';

  interface Props {
    name: string;
  }
  const { name }: Props = $props();
</script>

<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d={ICONS[name] ?? ''} /></svg>

<style>
  .icon {
    flex: none;
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
