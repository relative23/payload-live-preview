/**
 * The capabilities a source module holds, read from its syntax: whether it
 * listens to `postMessage`, calls `fetch`, creates a Trusted Types policy,
 * assigns `innerHTML`, sets an attribute. A layer rule says which module may
 * import which; this says which module may *do* what, which is the question a
 * reader asks before trusting the package with a page.
 *
 * It reads names, not data flow. `fetch` is `fetch` whether it is the global
 * or one a consumer injected, and an `innerHTML` assignment is a sink whatever
 * feeds it — the justification for each site is the sink inventory's job, and
 * the scanner's job is to make sure no site escapes it. Declaration names
 * (`readonly fetch?: FetchLike`) and type positions (`typeof fetch`) are not
 * uses and are skipped.
 */

import { Node, type CallExpression, type Identifier, type SourceFile } from 'ts-morph';

export type CapabilityKind =
  /** Reads messages from another window: `addEventListener('message')`, `onmessage =`. */
  | 'message-ingress'
  /** Posts to another window. */
  | 'message-egress'
  /** Talks to the network: `fetch`, XHR, WebSocket, EventSource, `sendBeacon`. */
  | 'network'
  /** A request that carries the visitor's cookies to another origin: `credentials: 'include'`. */
  | 'credentialed-request'
  /** Creates the Trusted Types policy every HTML sink relies on. */
  | 'trusted-types-policy'
  /** Turns a string into live markup: `innerHTML`, `outerHTML`, `srcdoc`, `insertAdjacentHTML`, `document.write`, … */
  | 'html-sink'
  /** Parses HTML into an inert document: `DOMParser`. */
  | 'html-parse'
  /** Loads or evaluates code: a `<script>` element, `eval`, `new Function`. */
  | 'script-load'
  /** Navigates the page: `location.assign/replace/reload`, `location.href =`, `window.open`. */
  | 'navigation'
  /** Writes an attribute or a URL-bearing property: `setAttribute`, `.src =`, `.href =`, `.style… =`. */
  | 'attribute-sink';

export interface CapabilityUse {
  readonly kind: CapabilityKind;
  /** The expression at the site, whitespace collapsed; sink inventories key on it. */
  readonly site: string;
  readonly line: number;
  /**
   * For an attribute sink, the attribute written when the code names it:
   * the literal in `setAttribute('href', …)`, the property in `img.src = …`,
   * `style` for any `.style.… =`. Absent when the name is computed.
   */
  readonly attribute?: string;
}

const GLOBAL_IDENTIFIERS: ReadonlyMap<string, CapabilityKind> = new Map([
  ['fetch', 'network'],
  ['XMLHttpRequest', 'network'],
  ['WebSocket', 'network'],
  ['EventSource', 'network'],
  ['sendBeacon', 'network'],
  ['importScripts', 'script-load'],
  ['eval', 'script-load'],
  ['DOMParser', 'html-parse'],
]);
/** Sinks are keyed by site in an inventory, so two on one line stay two; a global named twice in one expression is one use. */
const SITE_KEYED_KINDS: ReadonlySet<CapabilityKind> = new Set(['attribute-sink', 'html-sink']);

const HTML_SINK_PROPERTIES: ReadonlySet<string> = new Set(['innerHTML', 'outerHTML', 'srcdoc']);
const HTML_SINK_METHODS: ReadonlySet<string> = new Set([
  'insertAdjacentHTML',
  'setHTMLUnsafe',
  'createContextualFragment',
]);
const URL_PROPERTIES: ReadonlySet<string> = new Set([
  'src',
  'href',
  'srcset',
  'action',
  'formAction',
]);
const NAVIGATION_METHODS: ReadonlySet<string> = new Set(['assign', 'replace', 'reload']);

function collapsed(node: Node): string {
  return node.getText().replace(/\s+/gu, ' ');
}

/**
 * Whether an identifier is a use of the name rather than a declaration of it
 * or a mention in a type. `options.fetch` and `{ fetch }` are uses: they hand
 * the capability on. `readonly fetch?: …` and `typeof fetch` are not.
 */
function isExpressionUse(identifier: Identifier): boolean {
  const parent = identifier.getParent();
  if (Node.isPropertyAccessExpression(parent)) return true;
  if (Node.isShorthandPropertyAssignment(parent)) return true;
  if (Node.hasName(parent) && parent.getNameNode() === identifier) return false;
  return identifier.getFirstAncestor((ancestor) => Node.isTypeNode(ancestor)) === undefined;
}

function firstArgumentLiteral(call: CallExpression): string | undefined {
  const argument = call.getArguments()[0];
  return argument !== undefined && Node.isStringLiteral(argument)
    ? argument.getLiteralText()
    : undefined;
}

function callCapability(call: CallExpression): CapabilityKind | undefined {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const method = callee.getName();
  const receiver = callee.getExpression().getText();
  if (method === 'addEventListener') {
    return firstArgumentLiteral(call) === 'message' ? 'message-ingress' : undefined;
  }
  if (method === 'postMessage') return 'message-egress';
  if (method === 'createPolicy') return 'trusted-types-policy';
  if (HTML_SINK_METHODS.has(method)) return 'html-sink';
  if ((method === 'write' || method === 'writeln') && receiver.endsWith('document')) {
    return 'html-sink';
  }
  if (method === 'parseFromString') return 'html-parse';
  if (method === 'createElement') {
    return firstArgumentLiteral(call) === 'script' ? 'script-load' : undefined;
  }
  if (NAVIGATION_METHODS.has(method) && receiver.endsWith('location')) return 'navigation';
  if (method === 'open' && receiver === 'window') return 'navigation';
  if (method === 'setAttribute' || method === 'setAttributeNS') return 'attribute-sink';
  return undefined;
}

/** The statement an identifier sits in, so `typeof fetch === 'function' ? fetch : …` is one site; for an `if`, its condition. */
function enclosingStatement(node: Node): Node {
  const statement = node.getFirstAncestor((ancestor) => Node.isStatement(ancestor));
  if (statement === undefined) return node;
  return Node.isIfStatement(statement) ? statement.getExpression() : statement;
}

/** Every capability use in one source file, in source order. */
export function capabilityUsesIn(sourceFile: SourceFile): readonly CapabilityUse[] {
  const uses: CapabilityUse[] = [];
  const seen = new Set<string>();
  const record = (
    kind: CapabilityKind,
    node: Node,
    site: Node = node,
    attribute?: string,
  ): void => {
    const line = node.getStartLineNumber();
    const text = collapsed(site);
    const key = SITE_KEYED_KINDS.has(kind)
      ? `${kind}:${String(line)}:${text}`
      : `${kind}:${String(line)}`;
    if (seen.has(key)) return;
    seen.add(key);
    uses.push({ kind, site: text, line, ...(attribute === undefined ? {} : { attribute }) });
  };

  sourceFile.forEachDescendant((node) => {
    if (Node.isIdentifier(node)) {
      const kind = GLOBAL_IDENTIFIERS.get(node.getText());
      if (kind !== undefined && isExpressionUse(node)) record(kind, node, enclosingStatement(node));
      return;
    }
    if (Node.isPropertyAssignment(node)) {
      const initializer = node.getInitializer();
      if (
        node.getName() === 'credentials' &&
        initializer !== undefined &&
        Node.isStringLiteral(initializer) &&
        initializer.getLiteralText() === 'include'
      ) {
        record('credentialed-request', node);
      }
      return;
    }
    if (Node.isNewExpression(node)) {
      const constructed = node.getExpression();
      if (Node.isIdentifier(constructed) && constructed.getText() === 'Function') {
        record('script-load', node);
      }
      return;
    }
    if (Node.isCallExpression(node)) {
      const kind = callCapability(node);
      if (kind === 'attribute-sink') record(kind, node, node, firstArgumentLiteral(node));
      else if (kind !== undefined) record(kind, node);
      return;
    }
    if (Node.isBinaryExpression(node) && node.getOperatorToken().getText() === '=') {
      const left = node.getLeft();
      if (!Node.isPropertyAccessExpression(left)) return;
      const property = left.getName();
      const receiver = left.getExpression();
      // `element.innerHTML = X`: the inventory keys on X, the thing that is fed in.
      if (HTML_SINK_PROPERTIES.has(property)) record('html-sink', node, node.getRight());
      else if (property === 'onmessage') record('message-ingress', node);
      else if (property === 'href' && receiver.getText().endsWith('location')) {
        record('navigation', node);
      } else if (URL_PROPERTIES.has(property)) record('attribute-sink', node, node, property);
      else if (
        property === 'cssText' ||
        (Node.isPropertyAccessExpression(receiver) && receiver.getName() === 'style')
      ) {
        record('attribute-sink', node, node, 'style');
      }
    }
  });
  return uses;
}
