<script setup lang="ts">
/**
 * The Vue composable against a real Payload admin (tests/real-payload): the page
 * renders from `useLivePreviewDocument`, not from bindings the DOM runtime
 * patches. `PLP_PAYLOAD_SERVER_URL` names the admin, both the origin accepted
 * and the server the merged document is re-fetched from.
 */
import { useLivePreviewDocument } from 'payload-live-preview/vue';

interface Homepage {
  title?: string;
  subtitle?: string;
  author?: { email?: string } | number | null;
}

const admin = useRuntimeConfig().public.payloadUrl as string;
const { data, status, error, revision } = useLivePreviewDocument<Homepage>({
  serverURL: admin,
  allowedOrigins: admin === '' ? [] : [admin],
  initialData: { title: 'Composable initial title', subtitle: 'Composable initial subtitle' },
  depth: 1,
});
</script>

<template>
  <article data-testid="hook">
    <h1 data-testid="title">{{ data.title }}</h1>
    <p data-testid="subtitle">{{ data.subtitle }}</p>
    <p data-testid="author">
      {{ typeof data.author === 'object' && data.author ? data.author.email : '' }}
    </p>
    <p>
      status <span data-testid="status">{{ status }}</span
      >, revision <span data-testid="revision">{{ revision }}</span>
    </p>
    <p v-if="error" data-testid="error">{{ error.message }}</p>
  </article>
</template>
