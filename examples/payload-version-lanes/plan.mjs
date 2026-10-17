/**
 * The case plan of a Payload 2 probe: the one spec file it runs and the titles that file reports in
 * every browser. lanes.json is the only place the titles are written; the preparation, the harness
 * run, the result check and the discovery listing all read the plan from here, so no count is kept
 * twice and a README number can be held against what the lane executes.
 */
import { planTitles } from './v2/identity.mjs';

export const engines = ['chromium', 'firefox', 'webkit'];

// A probe is a spec file, the lanes.json list of its titles and the surfaces it can drive.
const PROBES = {
  dom: { file: 'payload2.spec.cjs', titles: 'expectedTitles', surfaces: ['dom'] },
  lifecycle: {
    file: 'native-lifecycle.spec.cjs',
    titles: 'nativeLifecycleTitles',
    surfaces: ['react', 'vue'],
  },
  population: {
    file: 'native-population.spec.cjs',
    titles: 'nativePopulationTitles',
    surfaces: ['react', 'vue'],
  },
};

/** Whether the probe can drive the surface. */
export const v2ProbeFits = (probe, surface) =>
  Object.hasOwn(PROBES, probe) && PROBES[probe].surfaces.includes(surface);

/** The probe's spec file with its titles, as lanes.json writes them. */
export function v2Specs(lane, probe) {
  if (!Object.hasOwn(PROBES, probe)) throw new Error('Unexpected v2 probe: ' + probe);
  return { [PROBES[probe].file]: lane[PROBES[probe].titles] };
}

export const v2Titles = (lane, probe) => planTitles(v2Specs(lane, probe));

/** Browser cases of one cell: every title once in every browser. */
export const v2Cases = (lane, probe) => v2Titles(lane, probe).length * engines.length;
