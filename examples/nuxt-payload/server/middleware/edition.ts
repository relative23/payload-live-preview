/**
 * This app's own request context: set for every request, read by the page
 * through `useRequestEvent()` and by the fragment's props as `locals`
 * (ADR 0029), so a server render and a fragment render agree.
 */
export default defineEventHandler((event) => {
  event.context.edition = 'Preview edition';
});
