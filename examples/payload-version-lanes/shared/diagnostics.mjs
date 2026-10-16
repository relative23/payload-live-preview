/**
 * Keep bounded failure reasons while withholding login arguments and tokens.
 * The copied admin and the browser reporter share this filter; neither stores
 * API steps, attachments, headers or raw configuration objects.
 */
import { Transform } from 'node:stream';

const fixtureSecrets = ['test1234', 'isolated-r6-fixture-secret-never-deploy'];
export function redact(value) {
  let text = String(value ?? '');
  for (const secret of fixtureSecrets)
    text = text.split(secret).join('[redacted fixture credential]');
  return text
    .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, '[redacted token]')
    .replace(/(payload-token\s*=\s*)[^;\s"'<>]+/giu, '$1[redacted token]')
    .replace(
      /(\bAuthorization["']?\s*[:=]\s*["']?\s*(?:Bearer|JWT)\s+)[^\s"']+/giu,
      '$1[redacted token]',
    );
}

export function diagnostic(error) {
  const message = typeof error?.message === 'string' ? error.message : 'Fixture operation failed';
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  return redact(message + '\n' + stack).slice(0, 6000);
}

export function redactedStream() {
  let pending = '';
  let discarding = false;
  return new Transform({
    transform(chunk, _encoding, next) {
      pending += chunk.toString('utf8');
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!discarding) this.push(redact(line) + '\n');
        discarding = false;
      }
      if (pending.length > 65_536) {
        if (!discarding) this.push('[overlong diagnostic line withheld]\n');
        pending = '';
        discarding = true;
      }
      next();
    },
    flush(next) {
      if (pending && !discarding) this.push(redact(pending) + '\n');
      next();
    },
  });
}
