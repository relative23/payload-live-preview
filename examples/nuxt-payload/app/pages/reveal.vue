<!--
  Reveal-edited-field target for reveal-nuxt.spec.ts: `footer` sits below a
  2,200px spacer, off-screen on load. Editing it must scroll it into view — the
  reveal feature through the Nuxt adapter.
-->
<template>
  <main style="margin:0;font:16px/1.5 system-ui,sans-serif">
    <h1 data-payload-field="heroTitle" data-testid="hero">Top</h1>
    <div style="height:2200px">scroll down for the footer</div>
    <p data-payload-field="footer" data-testid="footer">old footer</p>
  </main>
</template>
