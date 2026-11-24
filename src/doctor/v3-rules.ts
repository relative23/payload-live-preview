/**
 * The rows of the ADR 0007 ledger that 3.0 changes and a reading of the source
 * can decide, each as a rule over one call of the package. A rule answers that
 * the call changes, that its options could not be read, or nothing. Rows that
 * need the running page (a route refresh that returns nothing, row 23) or that
 * `pll migrate` rewrites (rows 1, 13 and 19) are not here.
 */
import { PACKAGE_NAME } from '../migrate/ast';
import { NO_OPTIONS, type OptionFacts } from './v3-options';

/** One call of a function or class the script binds from the package. */
export interface PackageCall {
  /** The exported name, as the package spells it. */
  readonly name: string;
  /** The entry it is imported from, such as `payload-live-preview/react`. */
  readonly entry: string;
  /** Per argument its facts, or `undefined` where the reader could not follow it. */
  readonly args: readonly (OptionFacts | undefined)[];
}

export interface V3Rule {
  readonly id: string;
  /** The ledger row; `undefined` for an option the ledger has no row for. */
  readonly row: number | undefined;
  /** What changes, as one line. */
  readonly title: string;
  /** What to write at the call. */
  readonly remedy: string;
}

export type V3Verdict = 'changes' | 'unread' | undefined;

interface Rule extends V3Rule {
  readonly judge: (call: PackageCall) => V3Verdict;
}

/** The options a rule looks at; `undefined` inside means the argument could not be read. */
interface Read {
  readonly options: OptionFacts | undefined;
}

/** `undefined`: the call is not one the rule concerns. */
type Target = Read | undefined;

/** An argument that is not there sets nothing, and that is known. */
const at = (call: PackageCall, index: number): Read => ({
  options: index < call.args.length ? call.args[index] : NO_OPTIONS,
});

const entryOf = (call: PackageCall): string => call.entry.slice(PACKAGE_NAME.length + 1);

/** The document hooks and the session behind them. */
function hook(call: PackageCall): Target {
  if (call.name === 'useLivePreviewDocument') return at(call, 0);
  return call.name === 'createDocumentSession' ? at(call, 1) : undefined;
}

/** What every request adapter, the generator and the browser client take as their first argument. */
const SETUP: ReadonlySet<string> = new Set([
  'createLivePreviewMiddleware',
  'livePreviewHandle',
  'livePreviewNitroPlugin',
  'defineLivePreviewServerHandler',
  'LivePreviewScript',
  'livePreviewScriptProps',
  'renderLivePreviewScript',
  'generateInlineScript',
  'initLivePreview',
]);

function setup(call: PackageCall): Target {
  // The Payload config plugin is `livePreview` too, and takes none of these options.
  const astroIntegration = call.name === 'livePreview' && entryOf(call) === 'astro';
  return astroIntegration || SETUP.has(call.name) ? at(call, 0) : undefined;
}

/** Whether `key` may be set though the reader does not see it set: behind a condition, or in a spread it could not follow. */
const unsure = (options: OptionFacts, key: string): boolean =>
  options.open || options.maybe.has(key);

/** A key the call has to set: missing changes, and where it may be set nobody can say. */
function missing(options: OptionFacts | undefined, key: string): V3Verdict {
  if (options === undefined) return 'unread';
  if (options.keys.has(key)) return undefined;
  return unsure(options, key) ? 'unread' : 'changes';
}

const RULES: readonly Rule[] = [
  {
    id: 'set-sanitizer-document',
    row: 16,
    title: '`setSanitizerDocument()` is removed',
    remedy:
      'Hand the document to the call that sanitizes: `sanitizeHtml(html, { document })`, `lexicalToHtml(content, { document })`.',
    judge: (call) => (call.name === 'setSanitizerDocument' ? 'changes' : undefined),
  },
  {
    id: 'lexical-document',
    row: 18,
    title:
      '`lexicalToHtml()` without a document throws `SanitizerEnvironmentError`; 2.x returns unsanitised markup with a warning',
    remedy:
      'Pass `{ document }` to the call, or `{ requireDocument: true }` to take the 3.0 behaviour now.',
    judge: (call) => {
      if (call.name !== 'lexicalToHtml') return undefined;
      const { options } = at(call, 1);
      if (options === undefined) return 'unread';
      const settled =
        options.keys.has('document') ||
        options.keys.get('requireDocument') === true ||
        options.keys.get('sanitize') === false;
      if (settled) return undefined;
      const perhaps = ['document', 'requireDocument', 'sanitize'].some((key) =>
        unsure(options, key),
      );
      return perhaps ? 'unread' : 'changes';
    },
  },
  {
    id: 'defaults-v1',
    row: 21,
    title: "`defaults: 'v1'`, the 1.x profile, is removed",
    remedy:
      '`pll migrate <path> --only expand-defaults-v1 --write` writes the rows it stands for into the options.',
    judge: (call) => (setup(call)?.options?.keys.get('defaults') === 'v1' ? 'changes' : undefined),
  },
  {
    id: 'referrer-detection',
    row: 22,
    title: '`new OriginDetector()` no longer trusts `document.referrer` unless told to',
    remedy:
      'Pass `enableReferrerDetection: true` where the detector relies on the referrer, `false` to take the 3.0 value now.',
    judge: (call) =>
      call.name === 'OriginDetector'
        ? missing(at(call, 0).options, 'enableReferrerDetection')
        : undefined,
  },
  {
    id: 'hook-document',
    row: 26,
    title:
      'A hook without `document` merges every update an allowed admin sends; 3.0 requires `document`',
    remedy: 'Name the document the page rendered: `document: { collection, id }` or `{ global }`.',
    judge: (call) => {
      const target = hook(call);
      return target === undefined ? undefined : missing(target.options, 'document');
    },
  },
  {
    id: 'merge-deadline',
    row: 27,
    title: 'A merge without a deadline gets a default one',
    remedy:
      'Set `mergeTimeoutMs` (`timeoutMs` on a hook) to the deadline you want, or to `0` to keep none.',
    judge: (call) => {
      const session = hook(call);
      if (session !== undefined) return missing(session.options, 'timeoutMs');
      const target = setup(call);
      if (target === undefined) return undefined;
      // Without `serverURL` the runtime builds no merger, so nothing waits.
      const cannotMerge =
        target.options !== undefined &&
        !target.options.keys.has('serverURL') &&
        !unsure(target.options, 'serverURL');
      return cannotMerge ? undefined : missing(target.options, 'mergeTimeoutMs');
    },
  },
  {
    id: 'hook-locale',
    row: 31,
    title: 'A hook with a `locale` leaves an update alone that names no locale',
    remedy: 'Set `requireLocale: true` to take the 3.0 behaviour now.',
    judge: (call) => {
      const document = hook(call)?.options?.keys.get('document');
      // Only a locale the call writes out: a document built elsewhere is not followed.
      if (typeof document !== 'object' || !document.keys.has('locale')) return undefined;
      return hook(call)?.options?.keys.get('requireLocale') === true ? undefined : 'changes';
    },
  },
  {
    id: 'script-props-inline',
    row: 32,
    title:
      '`livePreviewScriptProps()` no longer delivers the runtime inline, into every page that renders it',
    remedy:
      "Render `await LivePreviewScript({ request, ...options })`, or pass `delivery: 'asset'`.",
    judge: (call) => {
      if (call.name !== 'livePreviewScriptProps') return undefined;
      const { options } = at(call, 0);
      if (options?.keys.get('delivery') === 'asset') return undefined;
      // A `delivery` that is written out and is not 'asset' is inline, whatever else is open.
      const written = typeof options?.keys.get('delivery') === 'string';
      if (options !== undefined && (written || !unsure(options, 'delivery'))) return 'changes';
      return 'unread';
    },
  },
  {
    id: 'astro-mode',
    row: 33,
    title:
      'The Astro integration delivers a loader, not the inline runtime, when `mode` is not set',
    remedy:
      "Set `mode: 'inline'` to keep the 2.x delivery, or `mode: 'loader'` to take the 3.0 one now.",
    judge: (call) =>
      call.name === 'livePreview' && entryOf(call) === 'astro'
        ? missing(at(call, 0).options, 'mode')
        : undefined,
  },
  {
    id: 'strict-false',
    row: undefined,
    title:
      '`strict: false` gates response changes on intent alone, in production too; the ledger has no row for it yet',
    remedy: 'Remove it and pass `authorizePreview` and `allowedOrigins`.',
    judge: (call) => (setup(call)?.options?.keys.get('strict') === false ? 'changes' : undefined),
  },
];

/** The rules in the order a report names them: by ledger row, then what has none. */
export const V3_RULES: readonly V3Rule[] = RULES;

/** What each rule says about one call, for the rules that say something. */
export function judgeCall(call: PackageCall): ReadonlyMap<string, Exclude<V3Verdict, undefined>> {
  const verdicts = new Map<string, Exclude<V3Verdict, undefined>>();
  for (const rule of RULES) {
    const verdict = rule.judge(call);
    if (verdict !== undefined) verdicts.set(rule.id, verdict);
  }
  return verdicts;
}
