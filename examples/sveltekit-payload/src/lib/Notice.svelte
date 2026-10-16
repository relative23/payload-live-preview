<script lang="ts">
  /**
   * A component only the fragment endpoint renders: the page leaves its
   * boundary empty until the first unsaved `notice`. Its scoped rule reaches
   * the page only because the page imports it (ADR 0029).
   */
  let { text, edition = '' }: { text: string; edition?: string } = $props();
</script>

{#if text}
  <p class="notice" data-testid="notice">{text}</p>
  <p data-testid="notice-edition">{edition}</p>
{/if}

<style>
  .notice {
    outline: 3px solid rgb(200, 0, 0);
  }
</style>
