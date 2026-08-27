/**
 * Fetching and rendering for `pll doctor`.
 *
 * Deliberately not the barrel: index files are excluded from the coverage
 * report, and this file holds the only code in the audit that touches the
 * network and the only place response headers are normalised — precisely the
 * parts whose silent failure would make every header check report a false
 * finding. Living here, they are measured like everything else.
 *
 * @module @doctor/probe
 */
import { analyzeProbe } from './analyze';
import type { DoctorReport, DoctorResponse } from './types';

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
  /** Also check the served page against the 2.0 readiness table (`pll doctor --v2`). */
  readonly v2?: boolean;
}

/**
 * Normalise header names to lowercase.
 *
 * Exported because every header check downstream reads a lowercase key: if
 * this were wrong, `content-security-policy` and `x-frame-options` would both
 * read as absent and the audit would invent findings rather than report them.
 * A silent failure of exactly that shape is worth a test of its own.
 */
export function lowercaseHeaders(headers: Headers): Record<string, string> {
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
    {
      url: options.url,
      adminOrigin: options.adminOrigin,
      ...(options.v2 === true ? { v2: true } : {}),
    },
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
