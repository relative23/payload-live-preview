import { _ as attr, n as ensure_array_like, r as head, v as escape_html } from "../../chunks/server.js";
//#region src/routes/+page.svelte
function _page($$renderer) {
	/**
	* Preview target page. Mounted by the mock admin (and by tests) inside
	* an iframe. Every binding here is annotated with `data-payload-field`
	* so the live preview engine picks it up automatically.
	*
	* In a real SvelteKit project these initial values would come from
	* Payload via a `load` function; for the example we hard-code them.
	*
	* The markup mirrors `examples/astro-payload/src/pages/index.astro`
	* one-to-one (same field names, same attributes) so both example apps
	* exercise the exact same runtime surface.
	*/
	const initial = {
		title: "Hello from the demo",
		subtitle: "Type in the admin panel to see live updates.",
		hero: {
			url: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200",
			alt: "Mountains at dusk"
		},
		count: 12,
		publishedAt: "2025-04-12T08:30:00.000Z",
		tags: [
			"sveltekit",
			"payload",
			"live-preview"
		],
		ctaLabel: "Visit Payload",
		ctaUrl: "https://payloadcms.com"
	};
	head("1uha8ag", $$renderer, ($$renderer) => {
		$$renderer.title(($$renderer) => {
			$$renderer.push(`<title>Live Preview Demo</title>`);
		});
	});
	$$renderer.push(`<article class="grid"><header class="grid"><h1 data-payload-field="title">${escape_html(initial.title)}</h1> <p data-payload-field="subtitle">${escape_html(initial.subtitle)}</p></header> <img data-payload-field="hero" data-payload-type="image" data-payload-alt="hero.alt"${attr("src", initial.hero.url)}${attr("alt", initial.hero.alt)}/> <div data-payload-field="body" data-payload-richtext=""><h2>Rich text from Lexical</h2> <p>Mix of <strong>bold</strong>, <em>italic</em>, and <a href="https://example.com">links</a>.</p></div> <p>Count: <span data-payload-field="count" data-payload-type="number">${escape_html(initial.count)}</span></p> <p>Published: <time data-payload-field="publishedAt"${attr("datetime", initial.publishedAt)}>${escape_html(initial.publishedAt)}</time></p> <ul class="tags" data-payload-field="tags" data-payload-type="array" data-payload-array-template="&lt;li>{{value}}&lt;/li>"><!--[-->`);
	const each_array = ensure_array_like(initial.tags);
	for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
		let tag = each_array[$$index];
		$$renderer.push(`<li>${escape_html(tag)}</li>`);
	}
	$$renderer.push(`<!--]--></ul> <p><a data-payload-field="ctaLabel" data-payload-href="ctaUrl"${attr("href", initial.ctaUrl)} target="_blank" rel="noopener noreferrer">${escape_html(initial.ctaLabel)}</a></p></article>`);
}
//#endregion
export { _page as default };
