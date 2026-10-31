/**
 * The `pll doctor` audit: judge what a deployment serves from two fetches of
 * one URL, as a visitor and as the admin's iframe. Pure — the caller fetches.
 * Markup is read with regular expressions, which is enough to count
 * attributes inside start tags and find the runtime marker; findings say what
 * was observed.
 */
import { DIAGNOSTIC_CODES } from '../core/diagnostic-codes';
import { frameAncestorsAdmits, frameAncestorsOf } from './csp';
import { analyzeV2Readiness, readServedConfig } from './readiness';
import type {
  DoctorContext,
  DoctorFinding,
  DoctorProbe,
  DoctorReport,
  DoctorResponse,
} from './types';

/** Survives minification; the banner comment does not. */
const RUNTIME_MARKER = '__LIVE_PREVIEW_CONFIG__';
/**
 * A start tag, quoted values read whole so a `>` inside one does not end it.
 * Text is never a tag: `&lt;h1 data-payload-field=…&gt;` in a code sample, or
 * a sentence that names the attribute, is what a page shows, not what it binds.
 * A raw `<` outside quotes ends the attempt, which keeps the scan linear: with
 * it, `<a<a<a…` and no `>` took 645 ms for 20 000 repetitions, 15 times the
 * time of 5 000.
 */
const START_TAG = /<[a-zA-Z](?:"[^"]*"|'[^']*'|[^"'<>])*>/gu;
/** One attribute of a start tag: its name, and its value when it has one. */
const TAG_ATTRIBUTE = /([^\s"'>/=]+)(\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
/** Mirrors the scheduler default; the audit must not import the runtime. */
const DEFAULT_VISIBILITY_GATE_THRESHOLD = 50;
const LEVEL_ORDER = { error: 0, warning: 1, info: 2 } as const;
// An end tag may carry junk before its `>`; browsers still close on it, so the
// pattern must too, or a `</script foo>` would leave the script body counted.
const NON_MARKUP =
  /<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>|<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>|<!--[\s\S]*?-->/giu;

/**
 * The runtime's own source spells `data-payload-field=` in a message, so
 * scripts must not be counted. This is a counter's view of the page, not a
 * sanitiser — nothing here is rendered — but it strips to a fixed point all
 * the same, so a block that only appears once its neighbour is gone is still
 * removed rather than counted.
 */
function visibleMarkup(body: string): string {
  let markup = body;
  for (;;) {
    const stripped = markup.replace(NON_MARKUP, '');
    if (stripped === markup) return markup;
    markup = stripped;
  }
}

/** Read only beside `data-payload-field`; an owner, a strategy or a dependency also means something alone. */
const FIELD_MODIFIERS: ReadonlySet<string> = new Set(
  [
    'type',
    'attribute',
    'href',
    'src',
    'alt',
    'richtext',
    'html',
    'text',
    'array',
    'array-template',
    'array-separator',
    'structural',
    'locale',
    'format',
    'boundary',
  ].map((name) => `data-payload-${name}`),
);

/** An attribute as the markup carries it, at the offset of its tag. */
interface MarkupAttribute {
  readonly name: string;
  readonly value: string;
  readonly at: number;
}

/**
 * Every attribute with a value, in document order. Names are compared in lower
 * case, as a browser parses them; the tag name is read along and never matches
 * an attribute the audit asks about.
 */
function markupAttributes(markup: string): readonly MarkupAttribute[] {
  const found: MarkupAttribute[] = [];
  for (const tag of markup.matchAll(START_TAG)) {
    for (const [, name = '', assigned, double, single, bare] of tag[0].matchAll(TAG_ATTRIBUTE)) {
      if (assigned === undefined) continue;
      found.push({
        name: name.toLowerCase(),
        value: double ?? single ?? bare ?? '',
        at: tag.index,
      });
    }
  }
  return found;
}

/** The modifiers on start tags that bind no field, one entry per tag. */
function modifiersWithoutField(attributes: readonly MarkupAttribute[]): readonly string[] {
  const bound = new Set(named(attributes, 'data-payload-field').map((attribute) => attribute.at));
  const tags = new Map<number, string>();
  for (const { name, at } of attributes) {
    if (FIELD_MODIFIERS.has(name) && !bound.has(at) && !tags.has(at)) tags.set(at, name);
  }
  return [...tags.values()];
}

function named(attributes: readonly MarkupAttribute[], name: string): readonly MarkupAttribute[] {
  return attributes.filter((attribute) => attribute.name === name);
}

/** Bindings before the first owner marker are certainly unowned; nesting is not modelled, so this under-reports. */
function unownedBindingsBeforeFirstOwner(attributes: readonly MarkupAttribute[]): number {
  const firstOwner = named(attributes, 'data-payload-owner')[0];
  if (firstOwner === undefined) return 0;
  return named(attributes, 'data-payload-field').filter((binding) => binding.at < firstOwner.at)
    .length;
}

function tryUrl(value: string | undefined): URL | undefined {
  if (value === undefined) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** Why the preview response cannot be audited as a page; the public one may legitimately be gated. */
function describeNonPage(preview: DoctorResponse): DoctorFinding | undefined {
  if (preview.status >= 300 && preview.status <= 399) {
    const location = preview.headers['location'];
    return {
      code: 'LP0708',
      level: 'error',
      title: `The preview request was redirected (${String(preview.status)})${location === undefined ? '' : ` to ${location}`}`,
      detail:
        'The audit does not follow redirects: the page at the end of one is a different ' +
        'resource, usually a login or a canonical host, and judging it would say nothing ' +
        'about this URL.',
      remedy:
        'The request carried the intent parameter (?preview=true, or the --param name), the ' +
        "way the admin's iframe loads the page, so a rule that redirects on that query redirects " +
        'the iframe too. A redirect to a login means the route needs authentication that a ' +
        "plain probe cannot supply: pass an editor's credentials with --header, or a signed token as ?previewToken=… in the URL. Probe the final " +
        'URL directly only when the redirect has nothing to do with either.',
    };
  }
  if (preview.status < 200 || preview.status > 299) {
    return {
      code: 'LP0708',
      level: 'error',
      title: `The preview request returned ${String(preview.status)}, not a page`,
      detail:
        'Nothing below this can be judged: a status outside 2xx means the body is an ' +
        'error page or empty.',
      remedy: 'Check the URL.',
    };
  }
  if (preview.body.trim() === '') {
    return {
      code: 'LP0708',
      level: 'error',
      title: `The preview request returned ${String(preview.status)} with an empty body`,
      detail:
        'A 2xx status with nothing in it — 204 and 205 are defined that way — is not a page, ' +
        'so its missing runtime and missing bindings say nothing.',
      remedy: 'Point the audit at a route that renders a document.',
    };
  }
  const contentType = preview.headers['content-type'];
  if (contentType !== undefined && !contentType.toLowerCase().includes('html')) {
    return {
      code: 'LP0708',
      level: 'error',
      title: `The preview request returned ${contentType}, not HTML`,
      detail:
        'The audit reads a rendered page. A non-HTML response has no runtime and no ' +
        'bindings by definition, so reporting their absence would say nothing.',
      remedy: 'Point the audit at a page route rather than an API or an asset.',
    };
  }
  return undefined;
}

function framingFindings(
  preview: DoctorResponse,
  runtimeInPreview: boolean,
  context: DoctorContext,
): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const page = tryUrl(context.url);
  const admin = tryUrl(context.adminOrigin);
  const sameOrigin = admin !== undefined && page?.origin === admin.origin;
  const frameAncestors = frameAncestorsOf(preview.headers['content-security-policy']);
  if (runtimeInPreview && frameAncestors === undefined) {
    findings.push({
      code: 'LP0702',
      level: 'warning',
      title: 'Preview response declares no frame-ancestors',
      detail:
        'The runtime is injected but the response carries no frame-ancestors directive, ' +
        'so nothing states which origins may embed this page.',
      remedy:
        'Let the adapter manage CSP, or set frame-ancestors yourself to the admin origin. ' +
        'Without it you are relying on the absence of a policy.',
    });
  } else if (frameAncestors !== undefined && context.adminOrigin !== undefined) {
    const admitted =
      admin !== undefined &&
      page !== undefined &&
      frameAncestorsAdmits(frameAncestors, admin, page);
    if (!admitted) {
      findings.push({
        code: 'LP0702',
        level: 'error',
        title: 'frame-ancestors does not admit the admin origin',
        detail:
          admin === undefined
            ? `"${context.adminOrigin}" is not an absolute URL, so no source expression can admit it.`
            : `Served: "${frameAncestors}". Expected it to allow ${admin.origin}.`,
        remedy:
          'Add the admin origin to allowedOrigins so the adapter merges it into ' +
          'frame-ancestors, or add it to your own policy.',
      });
    }
  }
  const frameOptions = preview.headers['x-frame-options'];
  // A response with a `frame-ancestors` directive is framed by that directive alone: the HTML
  // Standard skips the header for it (measured in Chromium, Firefox and WebKit). The header
  // decides only where the response declares none; the directive's own verdict is LP0702.
  const blocks =
    frameOptions !== undefined &&
    frameAncestors === undefined &&
    (/deny/iu.test(frameOptions) || (/sameorigin/iu.test(frameOptions) && !sameOrigin));
  if (blocks) {
    // `SAMEORIGIN` refuses a frame from *another* origin, so it is a verdict
    // about this preview only once the admin origin is known. Without --admin
    // the audit says what it saw and names the condition instead of asserting a
    // block it cannot have established: where the admin and the site share an
    // origin, the preview runs. `DENY` needs no origin to be a verdict.
    const judged = admin !== undefined || /deny/iu.test(frameOptions);
    findings.push(
      judged
        ? {
            code: 'LP0703',
            level: 'error',
            title: `X-Frame-Options: ${frameOptions} blocks the preview iframe`,
            detail:
              'This header is older than CSP. A browser applies it to a response that has no ' +
              'frame-ancestors directive, and this response has no frame-ancestors.',
            remedy:
              'Remove X-Frame-Options for preview responses, or serve a frame-ancestors ' +
              'directive that admits the admin: the header is then ignored. It is usually ' +
              'set by a proxy or a security middleware rather than by the app.',
          }
        : {
            code: 'LP0703',
            level: 'warning',
            title: `X-Frame-Options: ${frameOptions} blocks every frame from another origin`,
            detail:
              'This header is older than CSP. A browser applies it to a response that has no ' +
              'frame-ancestors directive, and this response has no frame-ancestors. SAMEORIGIN ' +
              'refuses a frame from another origin only, and no admin origin was given: whether ' +
              'it blocks this preview depends on where the admin is served, which this probe ' +
              'cannot see.',
            remedy:
              'Re-run with --admin <origin> to have it judged. If the admin is on another ' +
              'origin, remove X-Frame-Options for preview responses or serve a frame-ancestors ' +
              'directive that admits it; a proxy or a security middleware usually sets the header.',
          },
    );
  }
  return findings;
}

/** The gate as the served script configures it; `threshold` is undefined when the gate is off. */
interface ServedGate {
  readonly threshold: number | undefined;
  readonly configured: boolean;
}

/**
 * Read from the served configuration, because an adapter now forwards both
 * options: judged against the default, a page that raised its threshold
 * would be told to raise it. A page whose configuration cannot be read
 * (loader mode, a client the page starts without a configuration element) is
 * judged against the default.
 */
function servedGate(body: string): ServedGate {
  const config = readServedConfig(body);
  if (config?.value('disableVisibilityGate') === true) {
    return { threshold: undefined, configured: true };
  }
  const threshold = config?.value('visibilityGateThreshold');
  return typeof threshold === 'number'
    ? { threshold, configured: true }
    : { threshold: DEFAULT_VISIBILITY_GATE_THRESHOLD, configured: false };
}

function bindingFindings(
  previewMarkup: string,
  publicMarkup: string,
  runtime: boolean,
  gate: ServedGate,
): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const preview = markupAttributes(previewMarkup);
  const previewBindings = named(preview, 'data-payload-field').length;
  const publicBindings = named(markupAttributes(publicMarkup), 'data-payload-field').length;
  const owners = named(preview, 'data-payload-owner').length;
  // A boundary is rendered by the server from the form state, so an edit of a
  // field it depends on arrives without one field binding; an empty id names
  // no registry entry, and no strategy renders it.
  const boundaries = named(preview, 'data-payload-fragment').filter(
    (boundary) => boundary.value.length > 0,
  ).length;
  if (publicBindings > 0) {
    findings.push({
      code: 'LP0704',
      level: 'warning',
      title: `${String(publicBindings)} binding attribute(s) served to anonymous visitors`,
      detail:
        'A request with no preview intent received data-payload-field attributes. These ' +
        'disclose the CMS field taxonomy, and any CSS keyed on them changes public layout ' +
        'the moment emission is gated.',
      remedy:
        'Gate binding emission on an authorized preview context — see ' +
        'createPreviewBindings(), whose suppressed form emits nothing at all.',
    });
  }
  const stranded = modifiersWithoutField(preview);
  if (stranded.length > 0) {
    findings.push({
      code: 'LP0711',
      level: 'warning',
      title: `${String(stranded.length)} element(s) carry ${stranded[0] ?? ''} or the like without a field`,
      detail:
        'The runtime reads these attributes only on a bound element, so they do nothing here, ' +
        'and it says nothing about them either.',
      remedy: 'Add data-payload-field to the element, or remove them.',
    });
  }
  if (gate.threshold !== undefined && previewBindings > gate.threshold) {
    findings.push({
      code: 'LP0705',
      level: 'warning',
      title: `${String(previewBindings)} bindings exceed the ${gate.configured ? 'configured' : 'default'} visibility gate`,
      detail:
        `Above visibilityGateThreshold (${String(gate.threshold)}) the ` +
        'scheduler stops writing offscreen elements and buffers them until they scroll into ' +
        'view. On a page nobody scrolls, that is never.',
      remedy:
        'Raise visibilityGateThreshold, or set disableVisibilityGate, on the adapter, ' +
        'LivePreviewClient or generateInlineScript() if the whole page must stay live, or ' +
        'confirm that deferring below the fold is acceptable here.',
    });
  }
  if (runtime && previewBindings === 0 && boundaries === 0) {
    findings.push({
      code: 'LP0707',
      level: 'error',
      title: 'Preview response carries no bindings',
      detail:
        'The runtime is present but there is not one data-payload-field element for it to ' +
        'write into and not one data-payload-fragment boundary for a server to render, so ' +
        'no edit can ever be visible on this page.',
      remedy:
        'Add binding attributes or fragment boundaries to the markup. pll-codegen --inventory ' +
        'lists every field the schema makes addressable.',
    });
  }
  const unowned = unownedBindingsBeforeFirstOwner(preview);
  if (owners > 0 && unowned > 0) {
    findings.push({
      code: 'LP0706',
      level: 'warning',
      title: `${String(unowned)} binding(s) outside every owner marker`,
      detail:
        `The page declares ${String(owners)} owner marker(s), so owner scoping is in use. ` +
        'Bindings that belong to no owner receive nothing once scopeBindingsByOwner is on — ' +
        'they fail closed.',
      remedy:
        'Give every binding an owning ancestor, or leave scopeBindingsByOwner off until they ' +
        'all have one. Counted before the first owner marker only, so the real number may be ' +
        'higher.',
    });
  }
  return findings;
}

/** Audit a probed deployment. */
export function analyzeProbe(
  probe: DoctorProbe,
  context: DoctorContext & {
    readonly v2?: boolean;
    /** Whether the preview probe carried caller-supplied headers (`--header`). */
    readonly credentials?: boolean;
  },
): DoctorReport {
  const { publicResponse: pub, previewResponse: preview } = probe;
  const notAPage = describeNonPage(preview);
  if (notAPage !== undefined) {
    return { url: context.url, findings: [notAPage], errors: 1, warnings: 0 };
  }
  const runtimeInPreview = preview.body.includes(RUNTIME_MARKER);
  const findings: DoctorFinding[] = [];
  if (!runtimeInPreview) {
    findings.push(
      context.credentials === true
        ? {
            code: 'LP0701',
            level: 'warning',
            title: 'No inline runtime in the preview response',
            detail:
              `The preview request returned ${String(preview.status)} without the inline ` +
              'runtime, although it carried credentials (--header, or ?previewToken= in the URL). Three readings: ' +
              'those credentials were not accepted — expired, issued for another page, or not ' +
              'what authorizePreview reads — an adapter that did not recognise the request as a ' +
              'preview, or a consumer that starts LivePreviewClient itself.',
            remedy:
              'Check that the credentials are current and are the ones authorizePreview reads; ' +
              'if you use an adapter, check its inject mode and previewSignals. If you start the ' +
              'client yourself, this line is expected.',
          }
        : {
            code: 'LP0701',
            level: 'warning',
            title: 'No inline runtime in the preview response',
            detail:
              `The preview request returned ${String(preview.status)} without the inline ` +
              'runtime. Three readings, and this audit cannot tell them apart from the response ' +
              'alone: a preview behind authorizePreview — the strict 2.0 default — which answers ' +
              'a request without credentials exactly like this, an adapter that did not recognise ' +
              'the request as a preview, or a consumer that starts LivePreviewClient itself.',
            remedy:
              "To audit a gated preview, send what an editor's browser sends: " +
              "--header 'Cookie: payload-token=…' for a Payload session; for a signed token, " +
              'the URL with ?previewToken=… (the default transport, dropped from the visitor ' +
              "request), or --header 'x-preview-token: …' where the strategy sets transport: " +
              "{ kind: 'header' }. Otherwise check the adapter's " +
              'inject mode and previewSignals; if you start the client yourself, this line is ' +
              'expected.',
          },
    );
  }
  findings.push(...framingFindings(preview, runtimeInPreview, context));
  findings.push(
    ...bindingFindings(
      visibleMarkup(preview.body),
      visibleMarkup(pub.body),
      runtimeInPreview,
      servedGate(preview.body),
    ),
  );
  if (pub.body.includes(RUNTIME_MARKER)) {
    // A page that starts its own client serves only the JSON element, which spells the name too.
    const inline = pub.body.includes(`var ${RUNTIME_MARKER}=`);
    findings.push({
      code: DIAGNOSTIC_CODES.RuntimeOnPublicPage,
      level: 'info',
      title: inline
        ? 'Runtime is also served to anonymous visitors'
        : 'Preview configuration is also served to anonymous visitors',
      detail: inline
        ? 'A request with no preview intent received the inline runtime. That is correct for ' +
          "inject: 'always' and unintended for 'preview-only'."
        : 'A request with no preview intent received the configuration element a page writes ' +
          'for a client it starts itself. That is correct if the page starts the client for ' +
          'every request, and unintended if it writes the element only for a preview.',
      remedy: '',
    });
  }
  if (context.v2 === true) findings.push(...analyzeV2Readiness(probe));
  findings.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return {
    url: context.url,
    findings,
    errors: findings.filter((finding) => finding.level === 'error').length,
    warnings: findings.filter((finding) => finding.level === 'warning').length,
  };
}
