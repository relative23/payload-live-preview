<script setup lang="ts">
/**
 * Shared markup for distinct Nuxt page commits. Its server-backed generation
 * also proves `refreshNuxtData()` settles before an unsaved revision is replayed.
 */

const props = defineProps<{ readonly step: string }>();
const route = useRoute();
const { data: generationResponse } = await useAsyncData('navigation-generation', () =>
  $fetch<{ generation: string }>('/api/navigation-generation'),
);
const generation = computed(() => generationResponse.value?.generation ?? 'missing');
const renderKey = computed(() => `${route.fullPath}:${generation.value}`);
const carriedQuery = computed(() => ({ ...route.query }));
const queryDestination = computed(() => ({
  path: route.path,
  query: { ...carriedQuery.value, view: 'query' },
}));
const secondDestination = computed(() => ({
  path: '/navigation-two',
  query: carriedQuery.value,
}));

function navigateRapidly(): void {
  const query = { ...route.query };
  void navigateTo({ path: '/navigation-slow', query });
  void navigateTo({ path: '/navigation-final', query });
}
</script>

<template>
  <article class="grid">
    <p data-testid="navigation-generation">{{ props.step }}:{{ generation }}</p>
    <h1 :key="renderKey" data-payload-field="title">Server title for {{ props.step }}</h1>
    <nav aria-label="Soft navigation fixture">
      <NuxtLink data-testid="navigate-query" :to="queryDestination"> Navigate by query </NuxtLink>
      <NuxtLink data-testid="navigate-two" :to="secondDestination">Navigate to two</NuxtLink>
      <button data-testid="navigate-rapid" type="button" @click="navigateRapidly">
        Navigate rapidly
      </button>
    </nav>
  </article>
</template>
