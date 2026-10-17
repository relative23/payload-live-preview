/**
 * Windows that post to the preview frame from the editor's admin document, and the switches a case
 * sets in the preview before its scripts run. Besides the admin's own window the cases need a window
 * of the admin's origin that is not the admin, windows of other origins, and a second frame the admin
 * can name as the receiver. Everything stays in the browser; the origins come from the run file.
 */
const { readFileSync } = require('node:fs');
const settings = JSON.parse(readFileSync(process.env.PLP_P2_RUN_FILE, 'utf8'));
const selector = `iframe.live-preview-iframe[src^="${settings.site}/${settings.surface}"]`;

// The preview server also answers on the loopback address, so its page has a second origin string
// without a second server.
const BY_ADDRESS = `http://127.0.0.1:${settings.sitePort}`;
const SOURCES = {
  // The admin's own origin, but not the admin's window.
  blank: 'about:blank',
  // The preview's origin: a page the admin may name as the receiver.
  site: `${settings.site}/${settings.surface}`,
  // Another origin: the same server reached by its address.
  address: `${BY_ADDRESS}/${settings.surface}`,
};

/** Switches for the consumer: set before its scripts run, read by v2/native/ledger.mjs. */
async function setKnobs(page, values) {
  await page.addInitScript(
    ({ site, values: knobs }) => {
      if (window.parent !== window && location.origin === site) window.__r6Knobs = knobs;
    },
    { site: settings.site, values },
  );
}

/** Where the preview frame stands among the admin document's frames, which is how a sender finds it. */
function previewIndex(page) {
  return page.evaluate(
    (frameSelector) =>
      Array.from(window.frames).indexOf(document.querySelector(frameSelector).contentWindow),
    selector,
  );
}

/**
 * A frame in the admin document: 'blank', 'site' or 'address' load a page, 'opaque' is a sandboxed
 * document whose origin is the string "null". The index is its place among the admin's frames.
 */
async function addFrame(page, kind) {
  const handle = await page.evaluateHandle(
    async ({ src, opaque }) => {
      const element = document.createElement('iframe');
      const loaded = new Promise((done) => element.addEventListener('load', done, { once: true }));
      if (opaque) {
        element.setAttribute('sandbox', 'allow-scripts');
        element.srcdoc = '<!doctype html><title>sender with an opaque origin</title>';
      } else element.src = src;
      document.body.append(element);
      await loaded;
      return element;
    },
    { src: SOURCES[kind], opaque: kind === 'opaque' },
  );
  const frame = await handle.asElement().contentFrame();
  const index = await page.evaluate(
    (element) => Array.from(window.frames).indexOf(element.contentWindow),
    handle,
  );
  return { frame, index };
}

/** A message from a frame of its own: the preview sees that frame's origin and window. */
function postFrom(sender, index, message) {
  return sender.evaluate(
    ({ at, data, origin }) => window.parent.frames[at].postMessage(data, origin),
    { at: index, data: message, origin: settings.site },
  );
}

/** A message from the admin's own window, which is the one the hook accepts by default. */
function postFromAdmin(page, index, message) {
  return page.evaluate(({ at, data, origin }) => window.frames[at].postMessage(data, origin), {
    at: index,
    data: message,
    origin: settings.site,
  });
}

/** The admin names another of its frames as the receiver; the preview's hook moves to that window. */
function selectReceiver(page, index) {
  return page
    .locator(selector)
    .evaluate(
      (element, at) =>
        element.contentWindow.postMessage(
          { type: 'r6-control', action: 'target', index: at },
          new URL(element.src).origin,
        ),
      index,
    );
}

module.exports = {
  BY_ADDRESS,
  addFrame,
  postFrom,
  postFromAdmin,
  previewIndex,
  selectReceiver,
  setKnobs,
};
