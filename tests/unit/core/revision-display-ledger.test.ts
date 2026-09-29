import { describe, expect, it, vi } from 'vitest';
import {
  RevisionDisplayLedger,
  runtimeDisplayHost,
  type RevisionDisplay,
} from '@core/revision-display';
import { EventEmitter } from '@events/emitter';
import type { UpdateScheduler } from '@core/update-scheduler';

/**
 * The ledger's own rules, without a runtime: which revision a fact belongs
 * to, when a state is said and when it is not said twice (ADR 0023).
 */

interface Key {
  outstanding: boolean;
}

function ledger(): {
  ledger: RevisionDisplayLedger<Key>;
  reports: RevisionDisplay[];
  failures: unknown[];
} {
  const reports: RevisionDisplay[] = [];
  const failures: unknown[] = [];
  const subject = new RevisionDisplayLedger<Key>();
  subject.host = {
    outstanding: (key) => key.outstanding,
    report: (display) => {
      reports.push(display);
    },
    failed: (error) => {
      failures.push(error);
    },
  };
  return { ledger: subject, reports, failures };
}

describe('RevisionDisplayLedger', () => {
  it('has nothing to say before the first revision, and records nothing for it', () => {
    const { ledger: subject, reports } = ledger();
    subject.shortfall({ outstanding: false }, { kind: 'merge' });
    subject.deferred({ outstanding: false }, 3);
    subject.requestSettle({ outstanding: false });
    expect(subject.snapshot()).toBeUndefined();
    expect(reports).toEqual([]);
  });

  it('works with its default host, which reports nothing and counts nothing as outstanding', async () => {
    const subject = new RevisionDisplayLedger<Key>();
    const key = { outstanding: true };
    subject.begin(key, 1);
    subject.requestSettle(key);
    await Promise.resolve();
    expect(subject.snapshot()?.state).toBe('current');
  });

  it('attributes facts only to the latest revision, and counts one shortfall once', async () => {
    const { ledger: subject, reports } = ledger();
    const old = { outstanding: false };
    const key = { outstanding: false };
    subject.begin(old, 1);
    subject.begin(key, 2);
    subject.shortfall(old, { kind: 'merge' });
    subject.deferred(old, 5);
    subject.shortfall(key, { kind: 'unbound', field: 'a' });
    subject.shortfall(key, { kind: 'unbound', field: 'a' });
    subject.deferred(key, 2);
    await Promise.resolve();
    expect(subject.snapshot()).toEqual({
      revision: 2,
      state: 'partial',
      shortfalls: [{ kind: 'unbound', field: 'a' }],
      deferred: 2,
      awaitingIslands: 0,
    });
    expect(reports.map((report) => [report.revision, report.state])).toEqual([
      [1, 'current'],
      [2, 'partial'],
    ]);
  });

  it('settles once per task however often it is asked, and ignores a request for an older revision', async () => {
    const { ledger: subject, reports } = ledger();
    const old = { outstanding: false };
    const key = { outstanding: false };
    subject.begin(old, 1);
    subject.begin(key, 2);
    const asked = vi.fn(subject.host.outstanding);
    subject.host = { ...subject.host, outstanding: asked };
    subject.requestSettle(old);
    subject.requestSettle(key);
    subject.requestSettle(key);
    await Promise.resolve();
    expect(reports.map((report) => report.revision)).toEqual([1, 2]);
    expect(asked).toHaveBeenCalledOnce();
  });

  it('drops a queued settle when a newer revision arrives first', async () => {
    const { ledger: subject, reports } = ledger();
    const first = { outstanding: false };
    subject.begin(first, 1);
    subject.requestSettle(first);
    const second = { outstanding: true };
    subject.begin(second, 2);
    await Promise.resolve();
    // The first said its settled state when the second arrived, and only then.
    expect(reports.map((report) => [report.revision, report.state])).toEqual([[1, 'current']]);
  });

  it('reports a revision with work left as superseded, and keeps saying superseded', () => {
    const { ledger: subject, reports } = ledger();
    const first = { outstanding: true };
    subject.begin(first, 1);
    subject.begin({ outstanding: true }, 2);
    expect(reports).toEqual([
      { revision: 1, state: 'superseded', shortfalls: [], deferred: 0, awaitingIslands: 0 },
    ]);
    expect(subject.snapshot()?.state).toBe('pending');
  });

  it("does not repeat a state it has said, and hands an older revision's island a callback that does nothing", async () => {
    const { ledger: subject, reports } = ledger();
    const old = { outstanding: false };
    subject.begin(old, 1);
    subject.requestSettle(old);
    await Promise.resolve();
    const key = { outstanding: false };
    subject.begin(key, 2);
    const stale = subject.handIsland(old);
    const displayed = subject.handIsland(key);
    stale();
    expect(subject.snapshot()?.awaitingIslands).toBe(1);
    displayed();
    displayed();
    expect(reports.map((report) => [report.revision, report.state])).toEqual([
      [1, 'current'],
      [2, 'current'],
    ]);
  });

  it('waits for islands only while nothing else is left, and a shortfall wins over them', async () => {
    const { ledger: subject, reports } = ledger();
    const key = { outstanding: true };
    subject.begin(key, 1);
    const displayed = subject.handIsland(key);
    subject.requestSettle(key);
    await Promise.resolve();
    expect(subject.snapshot()?.state).toBe('pending');
    key.outstanding = false;
    subject.shortfall(key, { kind: 'route-saved' });
    await Promise.resolve();
    displayed();
    expect(reports.map((report) => report.state)).toEqual(['partial']);
    expect(vi.isFakeTimers()).toBe(false);
  });

  it('counts an island once however often it confirms, and not at all for an older revision', () => {
    const { ledger: subject, reports } = ledger();
    const old = { outstanding: false };
    subject.begin(old, 1);
    const late = subject.handIsland(old);
    const key = { outstanding: false };
    subject.begin(key, 2);
    const displayed = subject.handIsland(key);
    late();
    expect(reports.map((report) => [report.revision, report.state])).toEqual([[1, 'unconfirmed']]);
    displayed();
    displayed();
    expect(subject.snapshot()).toMatchObject({ state: 'current', awaitingIslands: 0 });
  });

  it('says nothing more for a superseded revision whose queued settle runs after it finished', async () => {
    const { ledger: subject, reports } = ledger();
    const first = { outstanding: true };
    subject.begin(first, 1);
    subject.requestSettle(first);
    subject.begin({ outstanding: true }, 2);
    first.outstanding = false;
    await Promise.resolve();
    expect(reports.map((report) => [report.revision, report.state])).toEqual([[1, 'superseded']]);
  });

  it('hands a report that throws to the failure sink instead of the console', async () => {
    const { ledger: subject, failures } = ledger();
    const boom = new Error('boom');
    subject.host = {
      ...subject.host,
      report: () => {
        throw boom;
      },
    };
    const key = { outstanding: false };
    subject.begin(key, 1);
    subject.requestSettle(key);
    await Promise.resolve();
    expect(failures).toEqual([boom]);
  });

  it("sends the runtime's failures to its log", () => {
    const log = vi.fn();
    const host = runtimeDisplayHost(
      {
        scheduler: { pendingCount: 0 } as unknown as UpdateScheduler,
        emitter: new EventEmitter(),
        a11y: null,
        log,
      },
      { routeController: null, routeRetry: null },
    );
    const error = new Error('boom');
    host.failed(error);
    expect(log).toHaveBeenCalledWith('revision display failed:', error);
  });
});
