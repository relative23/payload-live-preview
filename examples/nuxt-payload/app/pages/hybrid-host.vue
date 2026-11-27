<script setup lang="ts">
/**
 * The host: what the Payload admin does. It asks the fixture endpoint for a
 * token bound to the route it frames — `?unauthorized=1` deliberately omits it
 * — and the test posts updates into the frame.
 */
const route = useRoute();
const unauthorized = route.query['unauthorized'] === '1';
const { data: token } = await useFetch('/preview-token', { query: { path: '/hybrid' } });
const src = computed(() =>
  unauthorized ? '/hybrid?preview=true' : `/hybrid?preview=true&previewToken=${token.value ?? ''}`,
);
</script>

<template>
  <iframe
    id="preview"
    data-testid="preview-frame"
    title="Preview"
    :src="src"
    style="width: 800px; height: 600px; border: 0; display: block"
  />
</template>
