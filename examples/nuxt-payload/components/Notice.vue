<script setup lang="ts">
/**
 * A component only the fragment endpoint renders: the page leaves its boundary
 * empty until the first unsaved `notice`. Its scoped rule reaches the page only
 * because the page imports it (ADR 0029). `edition` comes from the request's
 * own server context and `site` from the runtime config, both handed in as
 * props: a fragment is a standalone Vue app without Nuxt's (ADR 0030).
 */
const props = defineProps<{ text: string; edition?: string; site?: string }>();
// The fixture asks for a component that fails while rendering this way, so the
// E2E can hold the fallback in production too, where Vue only logs it (PHD-17).
if (props.text === 'throw in setup') throw new Error('the fixture was asked to fail in setup');
</script>

<template>
  <template v-if="text">
    <p class="notice" data-testid="notice">{{ text }}</p>
    <p data-testid="notice-edition">{{ edition }}</p>
    <p data-testid="notice-site">{{ site }}</p>
  </template>
</template>

<style scoped>
.notice {
  outline: 3px solid rgb(200, 0, 0);
}
</style>
