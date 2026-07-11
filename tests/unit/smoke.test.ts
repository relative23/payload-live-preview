import { describe, expect, it } from 'vitest';
import { VERSION } from '@/index';

describe('foundation smoke test', () => {
  it('exports a VERSION constant in the expected pre-release format', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[a-z]+\.\d+)?$/);
  });
});
