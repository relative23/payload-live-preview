/**
 * Observe completed native fetch bodies without Chromium's retained-body cache.
 * The browser gets the original promise and response immediately; only a clone
 * is read, and artifacts contain bounded verdicts rather than credentials or HTML.
 */
export interface AstroResponseCapture {
  complete: boolean;
  status?: number;
  bytes?: number;
  hasTitle?: boolean;
  hasCard?: boolean;
  error?: boolean;
}

/** Serializable by frame.evaluate; no module closure or package override. */
export function captureAstroResponses(): void {
  const original = window.fetch.bind(window);
  const records: AstroResponseCapture[] = [];
  Object.assign(window, { astroResourceResponses: records });
  window.fetch = (input, init) => {
    const pending = original(input, init);
    // One overflow slot makes excess calls a failure without unbounded logs.
    // The original network request is never replaced, retried or deferred.
    if (
      input !== '/payload/resource-fragment' ||
      init?.method !== 'POST' ||
      typeof init.body !== 'string' ||
      records.length >= 3
    ) {
      return pending;
    }
    let title: unknown;
    try {
      title = (JSON.parse(init.body) as { fields?: { title?: unknown } }).fields?.title;
    } catch {
      return pending;
    }
    if (title !== 'First unsaved card') return pending;
    const record: AstroResponseCapture = { complete: false };
    records.push(record);
    void pending
      .then(async (response) => {
        const text = await response.clone().text();
        Object.assign(record, {
          complete: true,
          status: response.status,
          bytes: new TextEncoder().encode(text).byteLength,
          hasTitle: text.includes('First unsaved card'),
          hasCard: text.includes('resource-card'),
        });
      })
      .catch(() => Object.assign(record, { complete: true, error: true }));
    return pending;
  };
}
