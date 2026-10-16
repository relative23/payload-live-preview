/**
 * Native Vue hydration owns the same component tree the server rendered.
 * Vue warnings and errors enter the ledger for the prepared gate to refuse.
 */
import { createSSRApp } from 'vue';
import { App } from './vue-app.mjs';
import { ledger } from './ledger.mjs';
const props = JSON.parse(document.getElementById('r6-props').textContent);
const app = createSSRApp(App, props);
app.config.warnHandler = (message) => ledger().hydrationErrors.push(message);
app.config.errorHandler = (error) => ledger().hydrationErrors.push(String(error));
app.mount(document.getElementById('app'));
