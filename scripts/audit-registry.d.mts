/**
 * The registry checker is also loaded directly by the dependency-free CI CLI.
 * These declarations keep its input types available to TypeScript consumers.
 */
export function parseUniqueJson(text: string): unknown;
export function validateNoFixVersions(versions: unknown, expected: string): void;
export function verifyNoFixTrack(name: string, version: string): void;
