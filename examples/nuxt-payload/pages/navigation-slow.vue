<script setup lang="ts">
/**
 * A deliberately slow navigation candidate. The fixture immediately starts a
 * later route so Nuxt must discard this candidate instead of committing it.
 */

await new Promise<void>((resolve) => setTimeout(resolve, 400));
</script>

<template>
  <NavigationFixture step="slow" />
</template>
