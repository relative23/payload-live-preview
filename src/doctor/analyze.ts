/**
 * The `pll doctor` audit: what a deployment actually serves.
 *
 * Every check here reads a response, not a configuration file. That is the
 * whole point. A config can say `allowedOrigins: [...]` while a proxy strips
 * the header, an adapter runs in a mode nobody remembers choosing, or a build
 * emits binding attributes on public pages. The gap between what a project
 * believes it is configured to do and what it puts on the wire is where this
 * project's most expensive findings have lived.
 *
 * The audit compares two fetches of the same URL: one as an ordinary visitor,
 * one shaped the way the admin's iframe requests it. Most of what matters is
 * in the difference between them.
 *
 * HTML is inspected with regular expressions rather than a parser. This is a
 * deliberate limit: the audit counts attributes and looks for the runtime
 * marker, which regexes do reliably, and it never needs a tree. A malformed
 * page can therefore be miscounted — findings say what was observed so the
 * reader can check.
 *
 * Nothing here is sent anywhere. The audit makes exactly the two requests it
 * is asked to make, to the URL it is given.
 *
 * @module @doctor/analyze
 */
import type {
  DoctorContext,
  DoctorFinding,
  DoctorProbe,
  DoctorReport,
  DoctorResponse,
} from './types';

/**
 * Marker the inline runtime always carries.
 *
 * The generator emits `var __LIVE_PREVIEW_CONFIG__=...` ahead of the runtime
 * body, and `generateInlineScript()` keeps that identifier verbatim so the
 * bundle can read it. The banner comment is not usable here — minification
 * strips it.
 */
const RUNTIME_MARKER = '__LIVE_PREVIEW_CONFIG__';

/** Any binding attribute from the public vocabulary. */
const BINDING_ATTRIBUTE = /\bdata-payload-field\s*=/gu;

/** Owner markers, which only exist once a consumer has adopted owner scoping. */
const OWNER_ATTRIBUTE = /\bdata-payload-owner\s*=/gu;

/** The runtime's own default, mirrored here so the audit can warn before it bites. */
const DEFAULT_VISIBILITY_GATE_THRESHOLD = 50;

const LEVEL_ORDER = { error: 0, warning: 1, info: 2 } as const;

function count(haystack: string, pattern: RegExp): number {
  return haystack.match(pattern)?.length ?? 0;
}

/**
 * Bindings that sit outside every element carrying an owner marker.
 *
 * Approximated by segmenting on owner markers: everything before the first
 * one is certainly unowned. Nesting and sibling scopes are not modelled, so
 * this under-reports rather than over-reports — a finding here is real, an
 * absence is not proof.
 */
function unownedBindingsBeforeFirstOwner(body: string): number {
  const firstOwner = body.search(/\bdata-payload-owner\s*=/u);
  if (firstOwner === -1) return 0;
  return count(body.slice(0, firstOwner), BINDING_ATTRIBUTE);
}

/**
 * Whether the admin is served from the same origin as the page being probed.
 *
 * This changes three verdicts, because a same-origin admin is admitted by
 * `'self'` and by `X-Frame-Options: SAMEORIGIN` without either naming it.
 * Getting this wrong turns a correct deployment into three red findings —
 * which is exactly what the first run against a real same-origin consumer did.
 */
function isSameOrigin(pageUrl: string, adminOrigin: string | undefined): boolean {
  if (adminOrigin === undefined) return false;
  try {
    return new URL(pageUrl).origin === new URL(adminOrigin).origin;
  } catch {
    return false;
  }
}

/**
 * Why this response cannot be audited as a page, or `undefined` if it can.
 *
 * Deliberately only the preview probe: the public response being a redirect or
 * a 404 is a legitimate shape for a gated site, and judging it would be the
 * same mistake in the other direction.
 */
function describeNonPage(preview: DoctorResponse): DoctorFinding | undefined {
  if (preview.status < 200 || preview.status > 299) {
    return {
      code: 'LP0708',
      level: 'error',
      title: `The preview request returned ${String(preview.status)}, not a page`,
      detail:
        'Nothing below this can be judged: a status outside 2xx means the ' +
        'body is an error page, a redirect target, or empty.',
      remedy:
        'Check the URL. A redirect to a login usually means the route needs ' +
        'authentication that a plain probe cannot supply.',
    };
  }
  if (preview.body.trim() === '') {
    return {
      code: 'LP0708',
      level: 'error',
      title: `The preview request returned ${String(preview.status)} with an empty body`,
      detail:
        'A 2xx status with nothing in it — 204 and 205 are defined that way — ' +
        'is not a page, so its missing runtime and missing bindings say nothing.',
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
        'The audit reads a rendered page. A non-HTML response has no runtime ' +
        'and no bindings by definition, so reporting their absence would say ' +
        'nothing about the deployment.',
      remedy: 'Point the audit at a page route rather than an API or an asset.',
    };
  }
  return undefined;
}

function frameAncestorsOf(csp: string | undefined): string | undefined {
  if (csp === undefined) return undefined;
  for (const directive of csp.split(';')) {
    const trimmed = directive.trim();
    if (trimmed.toLowerCase().startsWith('frame-ancestors')) return trimmed;
  }
  return undefined;
}

/**
 * Audit a probed deployment.
 *
 * Pure: the caller performs the two fetches and hands the results in.
 */
export function analyzeProbe(
  probe: DoctorProbe,
  context: DoctorContext & { readonly v2?: boolean },
): DoctorReport {
  const findings: DoctorFinding[] = [];
  const { publicResponse: pub, previewResponse: preview } = probe;
  const sameOrigin = isSameOrigin(context.url, context.adminOrigin);

  // Everything below reads a rendered page. A 404, a redirect to a login, a
  // 500 or a JSON endpoint would each be diagnosed as "no inline runtime,
  // perhaps you start the client yourself" — a plausible sentence about the
  // wrong problem, which is worse than saying nothing. Establish that there is
  // a page before judging its contents.
  const notAPage = describeNonPage(preview);
  if (notAPage !== undefined) {
    return {
      url: context.url,
      findings: [notAPage],
      errors: 1,
      warnings: 0,
    };
  }

  const runtimeInPreview = preview.body.includes(RUNTIME_MARKER);
  const runtimeInPublic = pub.body.includes(RUNTIME_MARKER);
  const previewBindings = count(preview.body, BINDING_ATTRIBUTE);
  const publicBindings = count(pub.body, BINDING_ATTRIBUTE);
  const owners = count(preview.body, OWNER_ATTRIBUTE);

  if (!runtimeInPreview) {
    findings.push({
      code: 'LP0701',
      level: 'warning',
      title: 'No inline runtime in the preview response',
      detail:
        `A request carrying Sec-Fetch-Dest: iframe returned ${String(preview.status)} ` +
        'without the inline runtime. Two readings, and this audit cannot tell them ' +
        'apart from the response alone: an adapter that did not recognise the ' +
        'request as a preview, or a consumer that starts LivePreviewClient itself ' +
        'and never wanted the inline build.',
      remedy:
        'If you use an adapter, check its inject mode and whether a proxy strips ' +
        'Sec-Fetch-Dest. If you start the client yourself, this line is expected.',
    });
  }

  const previewCsp = preview.headers['content-security-policy'];
  const frameAncestors = frameAncestorsOf(previewCsp);
  if (runtimeInPreview && frameAncestors === undefined) {
    findings.push({
      code: 'LP0702',
      level: 'warning',
      title: 'Preview response declares no frame-ancestors',
      detail:
        'The runtime is injected but the response carries no frame-ancestors ' +
        'directive, so nothing states which origins may embed this page.',
      remedy:
        'Let the adapter manage CSP, or set frame-ancestors yourself to the admin ' +
        'origin. Without it you are relying on the absence of a policy.',
    });
  } else if (
    frameAncestors !== undefined &&
    context.adminOrigin !== undefined &&
    !frameAncestors.includes(context.adminOrigin) &&
    // `'self'` names the admin without spelling it out when they share an origin.
    !(sameOrigin && frameAncestors.includes("'self'"))
  ) {
    findings.push({
      code: 'LP0702',
      level: 'error',
      title: 'frame-ancestors does not admit the admin origin',
      detail: `Served: "${frameAncestors}". Expected it to allow ${context.adminOrigin}.`,
      remedy:
        'Add the admin origin to allowedOrigins so the adapter merges it into ' +
        'frame-ancestors, or add it to your own policy.',
    });
  }

  const frameOptions = preview.headers['x-frame-options'];
  const frameOptionsBlocks =
    frameOptions !== undefined &&
    (/deny/iu.test(frameOptions) || (/sameorigin/iu.test(frameOptions) && !sameOrigin));
  if (frameOptionsBlocks) {
    findings.push({
      code: 'LP0703',
      level: 'error',
      title: `X-Frame-Options: ${frameOptions} blocks the preview iframe`,
      detail:
        'This header is older than CSP and browsers honour it independently. ' +
        'No frame-ancestors directive can override it.',
      remedy:
        'Remove X-Frame-Options for preview responses. It is usually set by a ' +
        'proxy or a security middleware rather than by the app.',
    });
  }

  if (publicBindings > 0) {
    findings.push({
      code: 'LP0704',
      level: 'warning',
      title: `${String(publicBindings)} binding attribute(s) served to anonymous visitors`,
      detail:
        'A request with no preview intent received data-payload-field attributes. ' +
        'These disclose the CMS field taxonomy, and any CSS keyed on them changes ' +
        'public layout the moment emission is gated.',
      remedy:
        'Gate binding emission on an authorized preview context — see ' +
        'createPreviewBindings(), whose suppressed form emits nothing at all.',
    });
  }

  if (previewBindings > DEFAULT_VISIBILITY_GATE_THRESHOLD) {
    findings.push({
      code: 'LP0705',
      level: 'warning',
      title: `${String(previewBindings)} bindings exceed the default visibility gate`,
      detail:
        `Above visibilityGateThreshold (${String(DEFAULT_VISIBILITY_GATE_THRESHOLD)}) ` +
        'the scheduler stops writing offscreen elements and buffers them until they ' +
        'scroll into view. On a page nobody scrolls, that is never.',
      remedy:
        'Raise visibilityGateThreshold if the whole page must stay live, or confirm ' +
        'that deferring below the fold is acceptable here.',
    });
  }

  if (runtimeInPreview && previewBindings === 0) {
    findings.push({
      code: 'LP0707',
      level: 'error',
      title: 'Preview response carries no bindings',
      detail:
        'The runtime is present but there is not one data-payload-field element ' +
        'for it to write into, so no edit can ever be visible on this page.',
      remedy:
        'Add binding attributes to the markup. pll-codegen --inventory lists every ' +
        'field the schema makes addressable.',
    });
  }

  const unowned = unownedBindingsBeforeFirstOwner(preview.body);
  if (owners > 0 && unowned > 0) {
    findings.push({
      code: 'LP0706',
      level: 'warning',
      title: `${String(unowned)} binding(s) outside every owner marker`,
      detail:
        `The page declares ${String(owners)} owner marker(s), so owner scoping is in ` +
        'use. Bindings that belong to no owner receive nothing once ' +
        'scopeBindingsByOwner is on — they fail closed.',
      remedy:
        'Give every binding an owning ancestor, or leave scopeBindingsByOwner off ' +
        'until they all have one. Counted before the first owner marker only, so ' +
        'the real number may be higher.',
    });
  }

  if (runtimeInPublic) {
    findings.push({
      code: 'LP0701',
      level: 'info',
      title: 'Runtime is also served to anonymous visitors',
      detail:
        'A request with no preview intent received the inline runtime. That is ' +
        "correct for inject: 'always' and unintended for 'preview-only'.",
      remedy: '',
    });
  }

  if (context.v2 === true) findings.push(...analyzeV2Readiness(probe));

  findings.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

  return {
    url: context.url,
    findings,
    errors: findings.filter((f) => f.level === 'error').length,
    warnings: findings.filter((f) => f.level === 'warning').length,
  };
}

/**
 * The inline configuration tuple as `readBuildConfig()` reads it, parsed from
 * the served inline script. The generator emits it as a JSON array after
 * `var __LIVE_PREVIEW_CONFIG__=`; only the runtime rows the readiness table
 * covers are read here, by position (ADR 0007, mirrored in runtime.ts).
 */
const CONFIG_MARKER = 'var __LIVE_PREVIEW_CONFIG__=';
const RUNTIME_SLOT = Object.freeze({
  disableReferrerDetection: 11,
  skipUnchanged: 14,
  eventSourcePolicy: 15,
  sanitizerPolicy: 16,
});

function parseInlineConfig(body: string): readonly unknown[] | undefined {
  const start = body.indexOf(CONFIG_MARKER);
  if (start === -1) return undefined;
  const index = start + CONFIG_MARKER.length;
  if (body[index] !== '[') return undefined;
  // Scan to the matching bracket, ignoring brackets inside strings.
  let depth = 0;
  let inString: string | undefined;
  for (let i = index; i < body.length; i += 1) {
    const ch = body[i];
    if (inString !== undefined) {
      if (ch === '\\') i += 1;
      else if (ch === inString) inString = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        const literal = body.slice(index, i + 1);
        try {
          // The generator emits array elisions (`,,`) for unset slots, which
          // JSON cannot express but a JS array literal can (a hole reads as
          // undefined). This runs in the Node doctor, never in the browser.
          // eslint-disable-next-line @typescript-eslint/no-implied-eval
          const read = new Function(`return (${literal});`) as () => unknown;
          const value: unknown = read();
          return Array.isArray(value) ? (value as readonly unknown[]) : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/**
 * Check the served preview against the 2.0 readiness table (roadmap 1.9.0):
 * each runtime row still at its 1.x value is one `LP0709` finding pointing at
 * `defaults: 'v2'`. Observable rows only — the ones baked into the inline
 * configuration; authorization and origin policy are the adapter's and are
 * covered by the existing frame-ancestors and bindings findings.
 */
export function analyzeV2Readiness(probe: DoctorProbe): readonly DoctorFinding[] {
  const config = parseInlineConfig(probe.previewResponse.body);
  const findings: DoctorFinding[] = [];
  if (config === undefined) {
    return [
      {
        code: 'LP0709',
        level: 'info',
        title: 'Could not read the inline configuration for a v2 readiness check',
        detail: 'The preview response carried no readable `__LIVE_PREVIEW_CONFIG__` inline script.',
        remedy:
          'Run this against a page with the inline runtime (not loader mode without a preview context).',
      },
    ];
  }
  const gap = (title: string, detail: string, remedy: string): DoctorFinding => ({
    code: 'LP0709',
    level: 'warning',
    title,
    detail,
    remedy,
  });
  if (config[RUNTIME_SLOT.disableReferrerDetection] !== true) {
    findings.push(
      gap(
        'Referrer trust is still on',
        'The runtime accepts the admin referer as a preview signal.',
        "Set `defaults: 'v2'` (or `disableReferrerDetection: true`) so referrer trust is off outside local dev.",
      ),
    );
  }
  if (config[RUNTIME_SLOT.eventSourcePolicy] !== 'parent-or-opener') {
    findings.push(
      gap(
        'Messages are accepted from any window',
        `eventSourcePolicy is ${JSON.stringify(config[RUNTIME_SLOT.eventSourcePolicy] ?? 'any')}.`,
        "Set `defaults: 'v2'` (or `eventSourcePolicy: 'parent-or-opener'`).",
      ),
    );
  }
  if (config[RUNTIME_SLOT.sanitizerPolicy] !== 'strict') {
    findings.push(
      gap(
        'Sanitizer is in compat mode',
        `sanitizerPolicy is ${JSON.stringify(config[RUNTIME_SLOT.sanitizerPolicy] ?? 'compat')}; id and every data-* pass.`,
        "Set `defaults: 'v2'` (or `sanitizerPolicy: 'strict'`) once rich text no longer relies on id/data-*.",
      ),
    );
  }
  if (config[RUNTIME_SLOT.skipUnchanged] !== true) {
    findings.push(
      gap(
        'Unchanged bindings are re-applied every message',
        'skipUnchanged is off.',
        "Set `defaults: 'v2'` (or `skipUnchanged: true`) to skip bindings whose value did not change.",
      ),
    );
  }
  return findings;
}
