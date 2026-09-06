<script lang="ts">
  /**
   * The boundary's content: what a patch cannot do. A section that exists only
   * when `subtitle` is set, and a value derived from `body`. The bindings
   * inside stay the fallback — when the endpoint cannot render, the runtime
   * patches them from the same revision.
   *
   * The same component renders the page (through +page.svelte) and every
   * fragment response, so the two can never drift apart.
   */
  import type { HeroDocument } from './hero';

  /** The binding attribute objects the page (or the endpoint) produced. */
  interface Props extends HeroDocument {
    bindings: { title: object; body: object };
  }

  let { title, subtitle, body, words, bindings }: Props = $props();
</script>

<h1 {...bindings.title} data-testid="hero-title">{title}</h1>
{#if subtitle}
  <p class="lede" data-testid="hero-subtitle">{subtitle}</p>
{/if}
<p {...bindings.body} data-testid="hero-body">{body}</p>
<p data-testid="hero-words">{words} words</p>
<input id="hero-input" data-testid="hero-input" aria-label="Scratch" />
