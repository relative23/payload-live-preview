import { describe, expect, it } from 'vitest';
import {
  normalize,
  parseDiagnosticCodes,
  render,
  replaceBlock,
  validate,
} from '../../../scripts/diagnostic-table';

/**
 * The generator behind the diagnostic-code table in docs/troubleshooting.md.
 * The README table it replaces had two codes with an empty "what to do" cell
 * and lacked three codes the source had gained, because nothing compared the
 * prose with the record.
 */

const SOURCE = `
export const DIAGNOSTIC_CODES = Object.freeze({
  /** No trusted origin configured in production; nothing will be accepted. */
  NoTrustedOrigin: 'LP0101',

  /** A value | with a pipe. */
  UnsafeAttributeWrite: 'LP0401',
  // LP0604 is reserved and unassigned; codes are never reused or renumbered.
  /** Runtime startup failed. */
  StartupFailed: 'LP0605',
  /** Appended later, out of numeric order. */
  V2ReadinessGap: 'LP0709',
} as const);
`;

const REMEDIES = {
  LP0101: 'Pass `allowedOrigins`.',
  LP0401: 'Bind a different attribute.',
  LP0605: 'Read the error event.',
  LP0709: 'Set the option the finding names.',
} as const;

describe('reading the source record', () => {
  it('pairs each code with the doc comment above it and collects the reserved ones', () => {
    const catalog = parseDiagnosticCodes(SOURCE);
    expect(catalog.entries.map((entry) => entry.code)).toEqual([
      'LP0101',
      'LP0401',
      'LP0605',
      'LP0709',
    ]);
    expect(catalog.entries[0]).toEqual({
      name: 'NoTrustedOrigin',
      code: 'LP0101',
      meaning: 'No trusted origin configured in production; nothing will be accepted.',
    });
    expect(catalog.reserved).toEqual(['LP0604']);
  });

  it('does not let a doc comment reach past an intervening line', () => {
    const catalog = parseDiagnosticCodes(
      "/** Orphaned comment. */\nconst x = 1;\nOrphanField: 'LP0201',\n",
    );
    expect(catalog.entries).toEqual([{ name: 'OrphanField', code: 'LP0201', meaning: '' }]);
  });
});

describe('rendering the table', () => {
  const block = render(parseDiagnosticCodes(SOURCE), REMEDIES);

  it('sorts by code, drops the terminal period of a meaning and escapes pipes', () => {
    const rows = block.split('\n').filter((line) => line.startsWith('| `LP'));
    expect(rows).toEqual([
      '| `LP0101` | No trusted origin configured in production; nothing will be accepted | Pass `allowedOrigins`. |',
      '| `LP0401` | A value \\| with a pipe | Bind a different attribute. |',
      '| `LP0605` | Runtime startup failed | Read the error event. |',
      '| `LP0709` | Appended later, out of numeric order | Set the option the finding names. |',
    ]);
  });

  it('states the reserved codes from the source, inside the generated block', () => {
    expect(block).toContain('Reserved and unassigned: `LP0604`.');
    expect(block.startsWith('<!-- diagnostic-codes:start -->')).toBe(true);
    expect(block.endsWith('<!-- diagnostic-codes:end -->')).toBe(true);
  });

  it('replaces only the marked block and refuses a document without markers', () => {
    const doc =
      'before\n<!-- diagnostic-codes:start -->\nold\n<!-- diagnostic-codes:end -->\nafter';
    expect(replaceBlock(doc, 'NEW')).toBe('before\nNEW\nafter');
    expect(() => replaceBlock('no markers here', 'NEW')).toThrow(/lacks the/u);
  });

  it('compares content, not the padding prettier adds to table cells', () => {
    expect(normalize('| `LP0101` | a    | b |\n| --- | ----- | --- |')).toBe(
      normalize('| `LP0101` |a|b|\n|---|---|---|'),
    );
  });
});

describe('what the check refuses', () => {
  it('passes a complete catalog', () => {
    expect(validate(parseDiagnosticCodes(SOURCE), REMEDIES)).toEqual([]);
  });

  it('names a code without a remedy and a remedy without a code', () => {
    const problems = validate(parseDiagnosticCodes(SOURCE), {
      LP0101: REMEDIES.LP0101,
      LP0401: REMEDIES.LP0401,
      LP0605: '',
      LP0709: REMEDIES.LP0709,
      LP0999: 'Stale.',
    });
    expect(problems).toEqual([
      'LP0605 (StartupFailed) has no "what to do" entry; add one to REMEDIES in scripts/diagnostic-table.ts',
      'REMEDIES names LP0999, which src/core/diagnostic-codes.ts does not define; remove it',
    ]);
  });

  it('refuses a code assigned twice, a reserved code taken, and an entry with no meaning', () => {
    const catalog = parseDiagnosticCodes(
      "/** One. */\nA: 'LP0101',\n/** Two. */\nB: 'LP0101',\n// LP0604 is reserved\n/** Taken. */\nC: 'LP0604',\nD: 'LP0102',\n",
    );
    expect(validate(catalog, { LP0101: 'x', LP0604: 'y', LP0102: 'z' })).toEqual([
      'LP0101 is assigned twice (A, B)',
      'LP0604 (C) is assigned but the source reserves it',
      'LP0102 (D) has no doc comment to render as its meaning',
    ]);
  });
});
