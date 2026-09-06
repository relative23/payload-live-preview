import { describe, expect, it } from 'vitest';
import {
  countLines,
  measureScope,
  measureTheirSource,
  REVIEWED_SCOPE_LINES,
} from '../../../scripts/compare-scope';

/**
 * The comparison report quotes one ratio, and a quoted number rots. These hold
 * the measurement that produces it: that both sides are authored source rather
 * than build output, and that our side has not moved without someone saying so.
 */

describe('counting lines', () => {
  it('leaves out what a reader does not have to follow', () => {
    const source = [
      '/**',
      ' * A doc comment.',
      ' */',
      '',
      'export const a = 1;',
      '// a line comment',
      'export const b = 2;',
    ].join('\n');

    expect(countLines(source)).toEqual({ total: 7, code: 2 });
  });
});

describe('the comparable scope', () => {
  it('reads their authored source, not their build output', async () => {
    const theirs = await measureTheirSource();

    // Every file they ship carries its `sourcesContent`; measuring `dist/*.js`
    // would count a compiler's line breaks instead of anyone's code.
    expect(theirs.files).toBeGreaterThan(5);
    expect(theirs.lines.code).toBeGreaterThan(50);
    expect(theirs.lines.code).toBeLessThan(theirs.lines.total);
  });

  it('matches the number the report quotes, exactly', async () => {
    const measurement = await measureScope();

    expect(measurement.ours.code).toBe(REVIEWED_SCOPE_LINES);
  });

  it('splits the scope so the hook session is not counted against their base package', async () => {
    const measurement = await measureScope();

    expect(measurement.groups.map((group) => group.title)).toEqual([
      'Protocol, origin and merge',
      'Document session behind a hook',
    ]);
    // Their React wrapper is a separate package; counting our session against
    // the base package alone would inflate the ratio in our own favour's
    // opposite direction, and either way it would not be the same job.
    const [protocol] = measurement.groups;
    expect(protocol?.ours.code).toBeLessThan(measurement.ours.code);
  });
});
