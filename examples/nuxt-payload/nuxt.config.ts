export default defineNuxtConfig({
  compatibilityDate: '2026-08-01',
  devtools: { enabled: false },
  // The mock admin is a static file so it never carries preview intent and
  // therefore never receives the runtime — the same split the other examples
  // use to keep "who gets injected" observable in the E2E suite.
  ssr: true,
});
