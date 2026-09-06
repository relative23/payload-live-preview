/**
 * `unbound-fields` plugin: a development overlay listing the fields an update
 * carried that the page has nowhere to put.
 *
 * Annotating a template is the work this package asks for, and the hardest part
 * of it is knowing what is still missing — `inspect().bindings.orphanFields`
 * answers that in the console, which is the wrong place while you are editing
 * markup. This puts the same answer in the preview, with the attribute to paste
 * one click away.
 *
 * It is a plugin, not part of the runtime: the inline artifact every page
 * carries must not grow by a development tool (the budget in
 * `scripts/bundle-budgets.ts` is the proof). Register it on a client you build
 * yourself, and only in development.
 */

import type { LivePreviewPlugin, PluginDisposer } from '../types';
import { createNameAddressability, SYSTEM_FIELD_NAMES } from '@core/unbound-fields';

const ELEMENT_ID = 'payload-live-preview-unbound';
const FIELD_ATTRIBUTE = 'data-payload-field';

export interface UnboundFieldsOverlayOptions {
  /**
   * Mount only when the client runs with `debug: true`. Default `true`: the
   * overlay is a development tool, and a production preview should not grow one
   * because a plugin list was copied between environments.
   */
  readonly onlyWithDebug?: boolean;
  /** Where to look for bindings and where to mount. Default `document`. */
  readonly root?: Document | Element;
  /** Corner of the preview to sit in. Default `'bottom-right'`. */
  readonly position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

const POSITIONS: Readonly<Record<NonNullable<UnboundFieldsOverlayOptions['position']>, string>> = {
  'bottom-right': 'bottom:12px;right:12px;',
  'bottom-left': 'bottom:12px;left:12px;',
  'top-right': 'top:12px;right:12px;',
  'top-left': 'top:12px;left:12px;',
};

const PANEL_STYLE =
  'position:fixed;z-index:2147483646;max-width:280px;max-height:40vh;overflow:auto;' +
  'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:#111;color:#eee;' +
  'border:1px solid #333;border-radius:6px;padding:8px 10px;box-shadow:0 4px 16px rgba(0,0,0,0.4);';

const BUTTON_STYLE =
  'display:block;width:100%;text-align:left;margin:2px 0;padding:2px 4px;border:0;border-radius:3px;' +
  'background:#222;color:#7fd1ff;font:inherit;cursor:pointer;';

/** The document this update named, minus everything the page can already show. */
export function unboundFieldNames(
  fields: Readonly<Record<string, unknown>>,
  boundNames: Iterable<string>,
  locale?: string,
): readonly string[] {
  const addressable = createNameAddressability(boundNames, locale);
  return Object.keys(fields)
    .filter((name) => !SYSTEM_FIELD_NAMES.has(name) && !addressable(name))
    .sort((left, right) => left.localeCompare(right));
}

function boundNamesIn(root: Document | Element): string[] {
  const names: string[] = [];
  for (const element of root.querySelectorAll(`[${FIELD_ATTRIBUTE}]`)) {
    const name = element.getAttribute(FIELD_ATTRIBUTE);
    if (name !== null && name.length > 0) names.push(name);
  }
  return names;
}

function hostDocument(root: Document | Element): Document | null {
  return root.nodeType === 9 ? (root as Document) : root.ownerDocument;
}

/** Copy through the async clipboard, falling back to a selection nobody has to see. */
function copy(doc: Document, text: string): void {
  const clipboard: unknown = doc.defaultView?.navigator.clipboard;
  if (clipboard !== undefined && clipboard !== null) {
    void (clipboard as Clipboard).writeText(text).catch(() => {
      selectInstead(doc, text);
    });
    return;
  }
  selectInstead(doc, text);
}

function selectInstead(doc: Document, text: string): void {
  const field = doc.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.setAttribute('style', 'position:fixed;opacity:0;pointer-events:none;');
  doc.body.append(field);
  field.select();
  field.remove();
}

interface Overlay {
  readonly update: (names: readonly string[]) => void;
  readonly destroy: PluginDisposer;
}

function mountOverlay(root: Document | Element, position: string): Overlay | null {
  const doc = hostDocument(root);
  if (doc?.body == null) return null;
  const panel = doc.createElement('aside');
  panel.id = ELEMENT_ID;
  panel.setAttribute('style', PANEL_STYLE + position);
  // Development furniture, not content: no screen reader should read it, and
  // no binding scan should ever reach into it.
  panel.setAttribute('aria-hidden', 'true');
  panel.hidden = true;
  const title = doc.createElement('div');
  title.textContent = 'Unbound fields';
  title.setAttribute('style', 'font-weight:600;margin-bottom:4px;');
  const list = doc.createElement('div');
  panel.append(title, list);
  doc.body.append(panel);

  return {
    update: (names) => {
      // A page that rewrote its body (a framework re-render, a route morph)
      // took the panel with it and may have left a serialized copy behind.
      // Re-attaching the real one is cheaper than watching for the rewrite.
      if (!panel.isConnected) {
        doc.getElementById(ELEMENT_ID)?.remove();
        doc.body.append(panel);
      }
      panel.hidden = names.length === 0;
      list.replaceChildren();
      for (const name of names) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = name;
        button.setAttribute('style', BUTTON_STYLE);
        button.title = `Copy ${FIELD_ATTRIBUTE}="${name}"`;
        button.addEventListener('click', () => {
          copy(doc, `${FIELD_ATTRIBUTE}="${name}"`);
          button.textContent = `${name} ✓`;
        });
        list.append(button);
      }
    },
    destroy: () => {
      panel.remove();
    },
  };
}

/**
 * ```ts
 * client.use(createUnboundFieldsOverlayPlugin());
 * ```
 *
 * Every update recomputes the list from the message's own fields and the
 * bindings currently in the DOM, so annotating the template makes entries
 * disappear as you save the file.
 */
export function createUnboundFieldsOverlayPlugin(
  options: UnboundFieldsOverlayOptions = {},
): LivePreviewPlugin {
  return {
    name: 'unbound-fields',
    version: '1.0.0',
    init: (ctx) => {
      const root = options.root ?? (typeof document === 'undefined' ? undefined : document);
      if (root === undefined) return;
      if ((options.onlyWithDebug ?? true) && ctx.getConfig()['debug'] !== true) {
        ctx.log('not mounted: the client runs without `debug: true`');
        return;
      }
      const overlay = mountOverlay(root, POSITIONS[options.position ?? 'bottom-right']);
      if (overlay === null) return;
      ctx.registerCleanup?.(overlay.destroy);
      ctx.events.on('afterUpdate', (e) => {
        const names = unboundFieldNames(e.data.fields, boundNamesIn(root), e.data.locale);
        overlay.update(names);
        if (names.length > 0) ctx.log('unbound:', names.join(', '));
      });
    },
  };
}
