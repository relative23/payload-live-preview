<script lang="ts">
  /**
   * One document's server-rendered panel on `/owners-hybrid`: its title and a
   * count derived from it, which only a server render can bring up to date.
   */
  interface Props {
    title: string;
    letters: number;
    bindings: { title: object };
  }

  let { title, letters, bindings }: Props = $props();
</script>

<h2 {...bindings.title} data-testid="panel-title">{title}</h2>
<p data-testid="panel-letters">{letters} letters</p>
