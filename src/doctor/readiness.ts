/**
 * `pll doctor --v2`: read the served inline configuration and report each
 * runtime row still at its 1.x value (ADR 0007).
 */
import type { DoctorFinding, DoctorProbe } from './types';

const CONFIG_MARKER = 'var __LIVE_PREVIEW_CONFIG__=';
/** Positions in the inline tuple; keep aligned with `RuntimeBuildConfig` in core/runtime.ts. */
const RUNTIME_SLOT = Object.freeze({
  disableReferrerDetection: 11,
  skipUnchanged: 14,
  eventSourcePolicy: 15,
  sanitizerPolicy: 16,
});

/**
 * The array literal after the marker, read as JSON. The generator writes `,,`
 * for unset slots, which JSON cannot express, so elisions outside strings
 * become `null`. Never evaluated: a page controls this text.
 */
export function readInlineConfig(body: string): readonly unknown[] | undefined {
  const start = body.indexOf(CONFIG_MARKER);
  if (start === -1) return undefined;
  const from = start + CONFIG_MARKER.length;
  if (body[from] !== '[') return undefined;
  let depth = 0;
  let inString = false;
  let previous = '';
  let json = '';
  for (let index = from; index < body.length; index += 1) {
    const char = body[index] ?? '';
    if (inString) {
      json += char;
      if (char === '\\') {
        json += body[index + 1] ?? '';
        index += 1;
      } else if (char === '"') {
        inString = false;
        // A closed string is a value: without this, the next `,` reads as an elision.
        previous = '"';
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      json += char;
      continue;
    }
    if (/\s/u.test(char)) continue;
    const elision =
      (char === ',' && (previous === ',' || previous === '[')) ||
      (char === ']' && previous === ',');
    if (elision) json += 'null';
    json += char;
    previous = char;
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return undefined;
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? (value as readonly unknown[]) : undefined;
  } catch {
    return undefined;
  }
}

function gap(title: string, detail: string, remedy: string): DoctorFinding {
  return { code: 'LP0709', level: 'warning', title, detail, remedy };
}

/** One `LP0709` finding per runtime row not yet at its 2.0 value; `null` slots count as unset. */
export function analyzeV2Readiness(probe: DoctorProbe): readonly DoctorFinding[] {
  const config = readInlineConfig(probe.previewResponse.body);
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
  const findings: DoctorFinding[] = [];
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
