/**
 * Record bounded browser outcomes without API-step arguments or attachments.
 * Login failures and process output can otherwise print private fixture values;
 * only redacted diagnostics enter the local report or coordinator log.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { redactor, diagnostic } = require('../template/diagnostics.cjs');

class Reporter {
  constructor() {
    this.settings = JSON.parse(readFileSync(process.env.PLP_P2_RUN_FILE, 'utf8'));
    this.redact = redactor(this.settings);
    this.tests = [];
    this.errors = [];
  }
  onBegin() {
    this.startedAt = new Date().toISOString();
  }
  printsToStdio() {
    return true;
  }
  onTestEnd(test, result) {
    const project = test.parent.project().name;
    const record = {
      project,
      title: this.redact(test.title),
      status: result.status,
      expectedStatus: test.expectedStatus,
      durationMs: result.duration,
      retry: result.retry,
      errors: result.errors.map((error) => diagnostic(error, this.redact)),
    };
    this.tests.push(record);
    console.log(project + ' ' + result.status + ': ' + record.title);
    for (const error of record.errors) console.error(error);
  }
  onError(error) {
    const message = diagnostic(error, this.redact);
    this.errors.push(message);
    console.error(message);
  }
  onEnd(result) {
    const report = {
      state: 'real-browser-results-require-evidence-audit',
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      variant: this.settings.variant,
      candidateSha256: this.settings.candidate.sha256,
      status: result.status,
      tests: this.tests,
      errors: this.errors,
      totals: {
        total: this.tests.length,
        passed: this.tests.filter((test) => test.status === 'passed').length,
        skipped: this.tests.filter((test) => test.status === 'skipped').length,
        failed: this.tests.filter((test) => !['passed', 'skipped'].includes(test.status)).length,
      },
    };
    writeFileSync(
      join(this.settings.run, 'browser-results.json'),
      JSON.stringify(report, null, 2) + '\n',
      { mode: 0o600 },
    );
  }
}

module.exports = Reporter;
