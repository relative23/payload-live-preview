/**
 * Keep useful bounded fixture errors while removing ephemeral credentials.
 * Both owned process logs and the browser reporter use the same filtering;
 * token values and raw configuration objects never become diagnostics.
 */
const { Transform } = require('node:stream');

function redactor(settings) {
  const secrets = [settings.email, settings.password, settings.secret]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .flatMap((value) => [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)])
    .sort((left, right) => right.length - left.length);
  return (value) => {
    let text = String(value ?? '');
    for (const secret of secrets) text = text.split(secret).join('[redacted credential]');
    return text
      .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, '[redacted token]')
      .replace(/(payload-token\s*=\s*)(?!\[redacted token\])[^;\s"'<>]+/giu, '$1[redacted token]')
      .replace(
        /(\bAuthorization["']?\s*[:=]\s*["']?\s*(?:Bearer|JWT)\s+)(?!\[redacted token\])[^\s"']+/giu,
        '$1[redacted token]',
      );
  };
}

function diagnostic(error, redact) {
  const name = typeof error?.name === 'string' ? error.name : 'Error';
  const code =
    typeof error?.code === 'string' || typeof error?.code === 'number'
      ? String(error.code)
      : 'unspecified';
  const message = typeof error?.message === 'string' ? error.message : 'Fixture operation failed';
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  return redact(`${name} code=${code}: ${message}\n${stack}`).slice(0, 6000);
}

function redactedStream(redact) {
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

module.exports = { redactor, diagnostic, redactedStream };
