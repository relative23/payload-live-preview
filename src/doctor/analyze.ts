/**
 * The `pll doctor` audit: judge what a deployment serves from two fetches of
 * one URL, as a visitor and as the admin's iframe. Pure — the caller fetches.
 * Markup is read with regular expressions, which is enough to count
 * attributes and find the runtime marker; findings say what was observed.
 */
import { DIAGNOSTIC_CODES } from '../core/diagnostic-codes';
import { frameAncestorsAdmits, frameAncestorsOf } from './csp';
import { analyzeV2Readiness } from './readiness';
import type {
  DoctorContext,
  DoctorFinding,
  DoctorProbe,
  DoctorReport,
  DoctorResponse,
} from './types';

/** Survives minification; the banner comment does not. */
const RUNTIME_MARKER = '__LIVE_PREVIEW_CONFIG__';
const BINDING_ATTRIBUTE = /\bdata-payload-field\s*=/gu;
const OWNER_ATTRIBUTE = /\bdata-payload-owner\s*=/gu;
/** Mirrors the scheduler default; the audit must not import the runtime. */
const DEFAULT_VISIBILITY_GATE_THRESHOLD = 50;
const LEVEL_ORDER = { error: 0, warning: 1, info: 2 } as const;
const NON_MARKUP =
  /<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/giu;

/** The runtime's own source spells `data-payload-field=` in a message, so scripts must not be counted. */
function visibleMarkup(body: string): string {
  return body.replace(NON_MARKUP, '');
}

function count(haystack: string, pattern: RegExp): number {
  return haystack.match(pattern)?.length ?? 0;
}

/** Bindings before the first owner marker are certainly unowned; nesting is not modelled, so this under-reports. */
function unownedBindingsBeforeFirstOwner(markup: string): number {
  const firstOwner = markup.search(/\bdata-payload-owner\s*=/u);
  return firstOwner === -1 ? 0 : count(markup.slice(0, firstOwner), BINDING_ATTRIBUTE);
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
        'Probe the final URL directly. A redirect to a login means the route needs ' +
        'authentication that a plain probe cannot supply.',
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
  const blocks =
    frameOptions !== undefined &&
    (/deny/iu.test(frameOptions) || (/sameorigin/iu.test(frameOptions) && !sameOrigin));
  if (blocks) {
    findings.push({
      code: 'LP0703',
      level: 'error',
      title: `X-Frame-Options: ${frameOptions} blocks the preview iframe`,
      detail:
        'This header is older than CSP and browsers honour it independently. No ' +
        'frame-ancestors directive can override it.',
      remedy:
        'Remove X-Frame-Options for preview responses. It is usually set by a proxy or a ' +
        'security middleware rather than by the app.',
    });
  }
  return findings;
}

function bindingFindings(
  previewMarkup: string,
  publicMarkup: string,
  runtime: boolean,
): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const previewBindings = count(previewMarkup, BINDING_ATTRIBUTE);
  const publicBindings = count(publicMarkup, BINDING_ATTRIBUTE);
  const owners = count(previewMarkup, OWNER_ATTRIBUTE);
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
  if (previewBindings > DEFAULT_VISIBILITY_GATE_THRESHOLD) {
    findings.push({
      code: 'LP0705',
      level: 'warning',
      title: `${String(previewBindings)} bindings exceed the default visibility gate`,
      detail:
        `Above visibilityGateThreshold (${String(DEFAULT_VISIBILITY_GATE_THRESHOLD)}) the ` +
        'scheduler stops writing offscreen elements and buffers them until they scroll into ' +
        'view. On a page nobody scrolls, that is never.',
      remedy:
        'Raise visibilityGateThreshold if the whole page must stay live, or confirm that ' +
        'deferring below the fold is acceptable here.',
    });
  }
  if (runtime && previewBindings === 0) {
    findings.push({
      code: 'LP0707',
      level: 'error',
      title: 'Preview response carries no bindings',
      detail:
        'The runtime is present but there is not one data-payload-field element for it to ' +
        'write into, so no edit can ever be visible on this page.',
      remedy:
        'Add binding attributes to the markup. pll-codegen --inventory lists every field ' +
        'the schema makes addressable.',
    });
  }
  const unowned = unownedBindingsBeforeFirstOwner(previewMarkup);
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
  context: DoctorContext & { readonly v2?: boolean },
): DoctorReport {
  const { publicResponse: pub, previewResponse: preview } = probe;
  const notAPage = describeNonPage(preview);
  if (notAPage !== undefined) {
    return { url: context.url, findings: [notAPage], errors: 1, warnings: 0 };
  }
  const runtimeInPreview = preview.body.includes(RUNTIME_MARKER);
  const findings: DoctorFinding[] = [];
  if (!runtimeInPreview) {
    findings.push({
      code: 'LP0701',
      level: 'warning',
      title: 'No inline runtime in the preview response',
      detail:
        `A request carrying Sec-Fetch-Dest: iframe returned ${String(preview.status)} without ` +
        'the inline runtime. Two readings, and this audit cannot tell them apart from the ' +
        'response alone: an adapter that did not recognise the request as a preview, or a ' +
        'consumer that starts LivePreviewClient itself and never wanted the inline build.',
      remedy:
        'If you use an adapter, check its inject mode and whether a proxy strips ' +
        'Sec-Fetch-Dest. If you start the client yourself, this line is expected.',
    });
  }
  findings.push(...framingFindings(preview, runtimeInPreview, context));
  findings.push(
    ...bindingFindings(visibleMarkup(preview.body), visibleMarkup(pub.body), runtimeInPreview),
  );
  if (pub.body.includes(RUNTIME_MARKER)) {
    findings.push({
      code: DIAGNOSTIC_CODES.RuntimeOnPublicPage,
      level: 'info',
      title: 'Runtime is also served to anonymous visitors',
      detail:
        'A request with no preview intent received the inline runtime. That is correct for ' +
        "inject: 'always' and unintended for 'preview-only'.",
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
