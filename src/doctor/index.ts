/**
 * `pll doctor` — probe a deployment and report what it actually serves.
 *
 * Fetching lives here; the judging lives in `@doctor/analyze`, which is pure
 * so the checks can be tested without a network.
 *
 * The audit performs exactly two GET requests to the URL it is given and
 * nothing else. No telemetry, no third-party calls, no credentials: the
 * preview probe carries the headers the admin's iframe would send, which is
 * enough to trigger preview-intent detection without authenticating.
 *
 * @module @doctor/index
 */
import { analyzeProbe } from './analyze';
import type { DoctorReport, DoctorResponse } from './types';

export { analyzeProbe } from './analyze';
// Findings are stamped with the same codes the runtime uses, so a consumer
// reading a report needs the vocabulary here too.
export { DIAGNOSTIC_CODES, type DiagnosticCode } from '../core/diagnostic-codes';
export type {
  DoctorContext,
  DoctorFinding,
  DoctorLevel,
  DoctorProbe,
  DoctorReport,
  DoctorResponse,
} from './types';

/** Injectable so tests can drive the audit without a server. */
export type DoctorFetch = (
  url: string,
  init: { readonly headers: Readonly<Record<string, string>> },
) => Promise<DoctorResponse>;

export interface RunDoctorOptions {
  readonly url: string;
  /** Admin origin the preview is meant to be embedded from, when known. */
  readonly adminOrigin?: string | undefined;
  /** Defaults to `globalThis.fetch`. */
  readonly fetchImpl?: DoctorFetch | undefined;
}

function lowercaseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

const defaultFetch: DoctorFetch = async (url, init) => {
  const response = await fetch(url, { headers: init.headers, redirect: 'follow' });
  return {
    status: response.status,
    headers: lowercaseHeaders(response.headers),
    body: await response.text(),
  };
};

/**
 * Fetch the URL twice — as a visitor and as the admin's iframe — and audit the
 * difference.
 */
export async function runDoctor(options: RunDoctorOptions): Promise<DoctorReport> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;

  const publicResponse = await fetchImpl(options.url, {
    headers: {
      // A plain top-level navigation. Deliberately no referer: an admin
      // referer is itself a preview signal, which would defeat the comparison.
      Accept: 'text/html',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
    },
  });

  const previewResponse = await fetchImpl(options.url, {
    headers: {
      Accept: 'text/html',
      // What the admin's iframe sends. This is the signal `'preview-only'`
      // injection keys on, so it is the honest way to ask for the preview
      // variant of the page.
      'Sec-Fetch-Dest': 'iframe',
      'Sec-Fetch-Mode': 'navigate',
      ...(options.adminOrigin !== undefined ? { Referer: `${options.adminOrigin}/` } : {}),
    },
  });

  return analyzeProbe(
    { publicResponse, previewResponse },
    { url: options.url, adminOrigin: options.adminOrigin },
  );
}

const LEVEL_LABEL = { error: 'ERROR', warning: 'WARN ', info: 'INFO ' } as const;

/** Render a report for a terminal. */
export function formatReport(report: DoctorReport): string {
  const lines: string[] = [`pll doctor — ${report.url}`, ''];
  if (report.findings.length === 0) {
    lines.push('No findings. The preview response carries the runtime, a frame-ancestors');
    lines.push('policy, and bindings; the public response carries none of them.', '');
    return lines.join('\n');
  }
  for (const finding of report.findings) {
    lines.push(`${LEVEL_LABEL[finding.level]} ${finding.code}  ${finding.title}`);
    lines.push(`      ${finding.detail}`);
    if (finding.remedy !== '') lines.push(`      → ${finding.remedy}`);
    lines.push('');
  }
  lines.push(`${String(report.errors)} error(s), ${String(report.warnings)} warning(s).`, '');
  return lines.join('\n');
}
