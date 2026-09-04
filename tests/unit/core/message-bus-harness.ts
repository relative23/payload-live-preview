/** Origins, message builders and promise helpers for the `MessageBus` suites. */

export const TRUSTED = 'https://admin.example.com';
export const UNTRUSTED = 'https://evil.example.com';

export function makeMessage(data: unknown, origin: string): MessageEvent {
  return new MessageEvent('message', { data, origin });
}

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}
