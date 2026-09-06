<script setup lang="ts">
/**
 * The boundary's content: what a patch cannot do. A section that exists only
 * when `subtitle` is set, and a value derived from `body`. The bindings inside
 * stay the fallback — when the endpoint cannot render, the runtime patches them
 * from the same revision.
 *
 * The same component renders the page and every fragment response, so the two
 * can never drift apart.
 */
import type { HeroDocument } from '../lib/hero';

defineProps<HeroDocument>();
</script>

<template>
  <h1 data-payload-field="title" data-testid="hero-title">{{ title }}</h1>
  <p v-if="subtitle" class="lede" data-testid="hero-subtitle">{{ subtitle }}</p>
  <p data-payload-field="body" data-testid="hero-body">{{ body }}</p>
  <p data-testid="hero-words">{{ words }} words</p>
  <input id="hero-input" data-testid="hero-input" aria-label="Scratch" />
</template>
