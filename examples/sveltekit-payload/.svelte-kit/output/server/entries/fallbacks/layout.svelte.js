import "../../chunks/server.js";
//#region node_modules/@sveltejs/kit/src/runtime/components/svelte-5/layout.svelte
function Layout($$renderer, $$props) {
	let { children } = $$props;
	children($$renderer);
	$$renderer.push(`<!---->`);
}
//#endregion
export { Layout as default };
