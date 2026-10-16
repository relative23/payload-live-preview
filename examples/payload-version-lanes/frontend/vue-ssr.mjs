/**
 * SSR executes the same native Vue component and installed composable.
 * A separate server renderer produces the initial markup before hydration.
 */
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { App } from './vue-app.mjs';
export function render(props) {
  return renderToString(createSSRApp(App, props));
}
