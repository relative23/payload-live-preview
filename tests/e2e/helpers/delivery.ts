import { expect, type APIRequestContext } from '@playwright/test';
import type { Carries, DeliveryBudget, DeliveryMeasurement } from '../../fixtures/delivery-budgets';

/**
 * Reads a public response the way an anonymous visitor gets it and takes it
 * apart into the two things a delivery decides: how many `<script>` elements
 * carry this package, and how large the one it emitted is once the runtime
 * artifact inside it is discounted.
 *
 * The artifact is fetched from the asset route a bootstrap advertises, so the
 * subtraction uses the same bytes the fixtures serve rather than a number
 * copied out of the build.
 */

/** Every script this package writes opens by declaring the config it was built with. */
const CONFIG_PRELUDE = 'var __LIVE_PREVIEW_CONFIG__=';
/** The bootstrap names the runtime it will fetch, hash and all, in this global. */
const RUNTIME_SRC = /var __LP_RUNTIME_SRC__="([^"]+)"/u;
const SCRIPT_ELEMENT = /<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/giu;
const BINDING_ATTRIBUTE = /\sdata-payload-[a-z-]+="/u;

/**
 * The fixture the artifact is taken from: a static Astro build, so it answers
 * the same bytes whatever else in the suite is running. Its bootstrap is also
 * the row with the plainest asset route, which makes a failure here readable.
 */
const ARTIFACT_SOURCE = 'http://localhost:4173';

export interface PublicResponse {
  readonly bytes: Buffer;
  readonly html: string;
}

export async function publicResponse(
  request: APIRequestContext,
  url: string,
): Promise<PublicResponse> {
  const response = await request.get(url);
  expect(response.status(), url).toBe(200);
  const bytes = await response.body();
  return { bytes, html: bytes.toString('utf8') };
}

/**
 * The runtime as the asset route serves it: no tag, no config, no prelude —
 * only the bytes every inline delivery repeats inside its own script element.
 */
export async function runtimeArtifact(request: APIRequestContext): Promise<string> {
  const { html } = await publicResponse(request, `${ARTIFACT_SOURCE}/`);
  const source = RUNTIME_SRC.exec(html)?.[1];
  expect(source, `${ARTIFACT_SOURCE}/ carries a bootstrap naming its runtime`).toBeDefined();
  const { html: artifact } = await publicResponse(request, `${ARTIFACT_SOURCE}${source!}`);
  return artifact;
}

/** The elements of a response that carry this package, emitted one first. */
function packageScripts(html: string): readonly string[] {
  const scripts: string[] = [];
  for (const [element, content] of html.matchAll(SCRIPT_ELEMENT)) {
    if (content!.includes('__LIVE_PREVIEW_CONFIG__')) scripts.push(element);
  }
  return scripts;
}

/**
 * The element the delivery wrote into the document, told apart from a copy a
 * framework made of it: a copy is a hydration payload and starts with the
 * framework's own call, never with the config this package declares.
 */
function emittedScript(scripts: readonly string[]): string | undefined {
  return scripts.find((element) =>
    element.slice(element.indexOf('>') + 1).startsWith(CONFIG_PRELUDE),
  );
}

function carriedBy(emitted: string | undefined, artifact: string): Carries {
  if (emitted === undefined) return 'nothing';
  return emitted.includes(artifact) ? 'runtime' : 'bootstrap';
}

export async function measureDelivery(
  request: APIRequestContext,
  budget: DeliveryBudget,
  artifact: string,
): Promise<DeliveryMeasurement> {
  const { bytes, html } = await publicResponse(request, `${budget.app}${budget.path}`);
  const scripts = packageScripts(html);
  const emitted = emittedScript(scripts);
  const carries = carriedBy(emitted, artifact);
  const emittedBytes = emitted === undefined ? 0 : Buffer.byteLength(emitted);
  return {
    carries,
    bindings: BINDING_ATTRIBUTE.test(html),
    scriptElements: scripts.length,
    overheadBytes:
      carries === 'runtime' ? emittedBytes - Buffer.byteLength(artifact) : emittedBytes,
    emittedBytes,
    pageBytes: bytes.byteLength,
  };
}

/** One line per row in the failure text, so a red run states the whole table. */
export function describeDelivery(measurement: DeliveryMeasurement): string {
  const { carries, emittedBytes, pageBytes, scriptElements } = measurement;
  return (
    `carries ${carries}: ${String(emittedBytes)} bytes emitted in ` +
    `${String(scriptElements)} element(s), ${String(pageBytes)} bytes of response`
  );
}
