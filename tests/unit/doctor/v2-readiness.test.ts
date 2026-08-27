import { describe, expect, it } from 'vitest';
import { analyzeV2Readiness } from '@doctor/analyze';
import { generateInlineScript } from '@inline/generator';
import type { DoctorProbe, DoctorResponse } from '@doctor/types';

/**
 * `pll doctor --v2` (roadmap 1.9.0): read the served inline configuration and
 * report each runtime readiness row still at its 1.x value. Driven with the
 * real generator so the slot positions this reads stay honest.
 */

function probe(inline: string): DoctorProbe {
  const response = (body: string): DoctorResponse => ({ status: 200, headers: {}, body });
  return {
    publicResponse: response('<h1>Title</h1>'),
    previewResponse: response(
      `<script>${inline}</script><h1 data-payload-field="title">Title</h1>`,
    ),
  };
}

describe('analyzeV2Readiness', () => {
  it('flags every runtime row for a default (v1) configuration', () => {
    const findings = analyzeV2Readiness(
      probe(generateInlineScript({ allowedOrigins: ['https://cms.example.com'] })),
    );
    const titles = findings.map((f) => f.title);
    expect(findings.every((f) => f.code === 'LP0709')).toBe(true);
    expect(titles).toEqual(
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
      // sanitizer and skipUnchanged left at v1
    });
    const titles = analyzeV2Readiness(probe(inline)).map((f) => f.title);
    expect(titles).toEqual([
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
