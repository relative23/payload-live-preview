/**
 * Record native browser outcomes without credential-bearing API step logs.
 * This private report requires a separate exact-count acceptance check; a
 * partial selection or skipped case cannot certify the lifecycle preparation.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { diagnostic, redact, redactedStream } from './diagnostics.mjs';

export default class Reporter {
  constructor() {
    this.tests = [];
    this.errors = [];
    this.stdout = redactedStream();
    this.stderr = redactedStream();
    this.stdout.pipe(process.stdout);
    this.stderr.pipe(process.stderr);
  }
  onBegin() {
    this.startedAt = new Date().toISOString();
  }
  onStdOut(chunk) {
    this.stdout.write(chunk);
  }
  onStdErr(chunk) {
    this.stderr.write(chunk);
  }
  onTestEnd(test, result) {
    const record = {
      project: test.parent.project().name,
      title: redact(test.title),
      status: result.status,
      expectedStatus: test.expectedStatus,
      outcome: test.outcome(),
      durationMs: result.duration,
      retry: result.retry,
      repeatEachIndex: test.repeatEachIndex,
      annotations: test.annotations.map(({ type }) => type),
      errors: result.errors.map(diagnostic),
    };
    this.tests.push(record);
    console.log(record.project + ' ' + record.status + ': ' + record.title);
    for (const error of record.errors) console.error(error);
  }
  onError(error) {
    const message = diagnostic(error);
    this.errors.push(message);
    console.error(message);
  }
  onEnd(result) {
    this.stdout.end();
    this.stderr.end();
    const report = {
      schemaVersion: 1,
      state: 'requires-exact-result-and-evidence-audit',
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      surface: process.env.PLP_R6_SURFACE,
      archiveSHA256: process.env.PLP_R6_ARCHIVE_SHA,
      status: result.status,
      tests: this.tests,
      errors: this.errors,
    };
    writeFileSync(
      resolve(process.env.PLP_R6_WORK, 'playwright-' + process.env.PLP_R6_SURFACE + '.json'),
      JSON.stringify(report, null, 2) + '\n',
      { mode: 0o600 },
    );
    if (
      this.tests.some(
        (test) =>
          test.status !== 'passed' ||
          test.expectedStatus !== 'passed' ||
          test.outcome !== 'expected' ||
          test.retry !== 0 ||
          test.repeatEachIndex !== 0 ||
          test.annotations.some((type) => ['skip', 'fixme', 'fail'].includes(type)),
      )
    )
      return { status: 'failed' };
  }
}
