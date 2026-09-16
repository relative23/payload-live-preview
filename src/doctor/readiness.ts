/**
 * `pll doctor --v2`: read the served inline configuration and report each
 * runtime row still at its 1.x value (ADR 0007).
 *
 * An empty slot means whatever the generation that wrote the script meant by
 * it, and that is exactly what changed between 1.x and 2.0. So the script
 * names the defaults it was resolved against, in its last slot, and this reads
 * the answer instead of guessing it. A script without the marker predates it —
 * 1.x or 2.0.0-beta.0 — and is read as 1.x, with a line that says so.
 */
import { INLINE_CONFIG_KEYS } from '@/types/inline-config';
import {
  V1_RUNTIME_DEFAULTS,
  V2_RUNTIME_DEFAULTS,
  type RuntimeProfileDefaults,
} from '@/types/defaults-profile';
import type { DoctorFinding, DoctorProbe } from './types';

const CONFIG_MARKER = 'var __LIVE_PREVIEW_CONFIG__=';
const DEFAULTS_SLOT = INLINE_CONFIG_KEYS.indexOf('defaults');

/** A runtime row of the readiness table, as a finding words it. */
interface ReadinessRow {
  readonly key: keyof RuntimeProfileDefaults;
  readonly title: string;
  /** What the 1.x value does. */
  readonly effect: string;
  /** What has to hold before the row can take its 2.0 value. */
  readonly condition: string;
}

const ROWS: readonly ReadinessRow[] = [
  {
    key: 'disableReferrerDetection',
    title: 'Referrer trust is still on',
    effect: 'the runtime accepts the admin referer as a preview signal.',
    condition: 'no preview flow relies on the admin referer alone',
  },
  {
    key: 'eventSourcePolicy',
    title: 'Messages are accepted from any window',
    effect: 'any window that passes the origin check may post updates.',
    condition: 'no window but the parent or opener posts updates',
  },
  {
    key: 'sanitizerPolicy',
    title: 'Sanitizer is in compat mode',
    effect: 'id and every data-* pass.',
    condition: 'rich text no longer relies on `id` or `data-*`',
  },
  {
    key: 'skipUnchanged',
    title: 'Unchanged bindings are re-applied every message',
    effect: 'every binding is written again on every message.',
    condition: 'no renderer relies on running again for a value that did not change',
  },
];

/** Where a row's value came from, which decides what the reader can change. */
type Origin = 'profile' | 'explicit' | 'unmarked';

const ORIGIN_DETAIL: Readonly<Record<Origin, string>> = {
  profile: "The script was generated with `defaults: 'v1'`.",
  explicit: 'The script sets it explicitly.',
  unmarked: 'The script names no defaults, so its empty slot is read as the 1.x value.',
};

const UNREADABLE: DoctorFinding = {
  code: 'LP0709',
  level: 'info',
  title: 'Could not read the inline configuration for a v2 readiness check',
  detail: 'The preview response carried no readable `__LIVE_PREVIEW_CONFIG__` inline script.',
  remedy:
    'Run this against a page with the inline runtime (not loader mode without a preview context). ' +
    'A preview behind authorizePreview serves it only to a request with credentials: pass them with --header.',
};

const UNMARKED: DoctorFinding = {
  code: 'LP0709',
  level: 'info',
  title: 'The inline configuration does not say which defaults it was generated against',
  detail:
    'Scripts carry a `defaults` marker from 2.0.0-rc.1 on; this one has none, so a 1.x or 2.0.0-beta.0 generator wrote it. An empty slot is read as its 1.x value, which is what a 1.x runtime runs.',
  remedy:
    'On 1.x the warnings stand as written. On 2.0.0-beta.0 an empty slot already runs its 2.0 value, so a warning about one does not apply there; upgrade and run `pll doctor --v2` again to read the marker.',
};

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

/** `'compat'` rather than `"compat"`: remedies are read as source code. */
function literal(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : JSON.stringify(value);
}

function remedyFor(origin: Origin, row: ReadinessRow, value: unknown): string {
  const wanted = `\`${row.key}: ${literal(V2_RUNTIME_DEFAULTS[row.key])}\``;
  switch (origin) {
    case 'profile':
      return `Set ${wanted} or drop \`defaults: 'v1'\` once ${row.condition}.`;
    case 'explicit':
      return `Drop the explicit \`${row.key}: ${literal(value)}\` once ${row.condition}; 2.0 defaults to ${wanted}.`;
    case 'unmarked':
      // 1.8.1 has no `defaults` option and three of the four rows are not
      // inline options there, so the way out is the upgrade itself.
      return `Upgrading to 2.0 sets ${wanted}; check first that ${row.condition}.`;
  }
}

function gap(row: ReadinessRow, value: unknown, origin: Origin): DoctorFinding {
  return {
    code: 'LP0709',
    level: 'warning',
    title: row.title,
    detail: `${row.key} is ${literal(value)}: ${row.effect} ${ORIGIN_DETAIL[origin]}`,
    remedy: remedyFor(origin, row, value),
  };
}

function unknownGeneration(marker: unknown): DoctorFinding {
  return {
    code: 'LP0709',
    level: 'info',
    title: 'The inline configuration names defaults this doctor does not know',
    detail: `Its \`defaults\` marker is ${JSON.stringify(marker)}; this version reads 'v1' and 'v2', so no row was judged.`,
    remedy: 'Run the `pll doctor` of the package version that generated the page.',
  };
}

/**
 * One `LP0709` finding per runtime row not yet at its 2.0 value. An empty slot
 * has the value of the generation the script names, and the 1.x value when it
 * names none; a generation this version does not know is not judged at all.
 * @internal
 */
export function analyzeV2Readiness(probe: DoctorProbe): readonly DoctorFinding[] {
  const config = readInlineConfig(probe.previewResponse.body);
  if (config === undefined) return [UNREADABLE];
  const marker = config[DEFAULTS_SLOT] ?? undefined;
  if (marker !== undefined && marker !== 'v1' && marker !== 'v2') {
    return [unknownGeneration(marker)];
  }
  const generation = marker;
  const fallback = generation === 'v2' ? V2_RUNTIME_DEFAULTS : V1_RUNTIME_DEFAULTS;
  const findings = ROWS.flatMap((row) => {
    const slot = config[INLINE_CONFIG_KEYS.indexOf(row.key)] ?? undefined;
    const value = slot ?? fallback[row.key];
    if (value === V2_RUNTIME_DEFAULTS[row.key]) return [];
    const origin: Origin =
      generation === 'v1' ? 'profile' : slot === undefined ? 'unmarked' : 'explicit';
    return [gap(row, value, origin)];
  });
  return generation === undefined ? [...findings, UNMARKED] : findings;
}
