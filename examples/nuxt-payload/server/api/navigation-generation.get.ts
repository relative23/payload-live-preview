/**
 * A fresh server value for the native route-refresh fixture. Its only job is
 * to prove `refreshNuxtData()` settled before an unsaved revision is reapplied.
 */

export default defineEventHandler(() => ({ generation: crypto.randomUUID() }));
