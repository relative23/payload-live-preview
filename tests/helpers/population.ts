/**
 * Preserve the concrete fetch URL when a population test inspects its query.
 * Request objects use their URL, rather than the default object stringification.
 */
export function populationURL(input: RequestInfo | URL | undefined): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  if (input instanceof Request) return new URL(input.url);
  throw new Error('population request did not provide a URL');
}
