/**
 * The reveal ledger decides which binding a revision scrolls to. Its one
 * subtle rule: the ledger learns a value only when the revision that saw it
 * reaches its reveal point, so a superseding re-send of the same edit still
 * finds the change and reveals it.
 */

import { describe, expect, it } from 'vitest';
import { RevealLedger, type RevealSlot } from '@core/reveal-ledger';

interface Binding {
  readonly owner?: string | undefined;
  readonly locale?: string | undefined;
  readonly fieldName: string;
}

function slot(): RevealSlot<Binding> {
  return { revealIdentities: [], revealTarget: undefined };
}

const TITLE: Binding = { owner: 'collection:pages:1', fieldName: 'title' };
const BODY: Binding = { owner: 'collection:pages:1', fieldName: 'body' };

describe('RevealLedger', () => {
  it('records the first value as a baseline without marking a reveal', () => {
    const ledger = new RevealLedger();
    const first = slot();
    ledger.note(first, TITLE, 'Hello');
    expect(first).toEqual({ revealIdentities: [], revealTarget: undefined });
  });

  it('marks the first binding whose value moved and remembers every moved key', () => {
    const ledger = new RevealLedger();
    const baseline = slot();
    ledger.note(baseline, TITLE, 'Hello');
    ledger.note(baseline, BODY, 'Text');
    const edit = slot();
    ledger.note(edit, TITLE, 'Hello!');
    ledger.note(edit, BODY, 'Text!');
    expect(edit.revealTarget).toBe(TITLE);
    expect(edit.revealIdentities.map(([key]) => key)).toHaveLength(2);
  });

  it('does not mark a value the ledger already shows', () => {
    const ledger = new RevealLedger();
    ledger.note(slot(), TITLE, 'Hello');
    const again = slot();
    ledger.note(again, TITLE, 'Hello');
    expect(again.revealTarget).toBeUndefined();
  });

  it('hands out the target once and empties the slot', () => {
    const ledger = new RevealLedger();
    ledger.note(slot(), TITLE, 'Hello');
    const edit = slot();
    ledger.note(edit, TITLE, 'Hello!');
    expect(ledger.commit(edit)).toBe(TITLE);
    expect(edit).toEqual({ revealIdentities: [], revealTarget: undefined });
    expect(ledger.commit(edit)).toBeUndefined();
  });

  it('learns a value only at commit, so a superseding re-send still reveals it', () => {
    const ledger = new RevealLedger();
    ledger.note(slot(), TITLE, 'Hello');
    const superseded = slot();
    ledger.note(superseded, TITLE, 'Hello!');
    // The revision above never reaches its reveal point; the re-send does.
    const resend = slot();
    ledger.note(resend, TITLE, 'Hello!');
    expect(ledger.commit(resend)).toBe(TITLE);
    // Now the ledger shows the value, and the same edit is no longer a change.
    const after = slot();
    ledger.note(after, TITLE, 'Hello!');
    expect(after.revealTarget).toBeUndefined();
  });

  it.each([
    ['another document', { owner: 'collection:pages:2', fieldName: 'title' }],
    ['another locale', { owner: 'collection:pages:1', locale: 'de', fieldName: 'title' }],
    ['no owner at all', { fieldName: 'title' }],
  ])('keys the same field name separately for %s', (_case, other: Binding) => {
    const ledger = new RevealLedger();
    ledger.note(slot(), TITLE, 'Hello');
    ledger.note(slot(), other, 'Hallo');
    const edit = slot();
    ledger.note(edit, TITLE, 'Hello!');
    ledger.note(edit, other, 'Hallo');
    expect(edit.revealIdentities).toHaveLength(1);
    expect(edit.revealTarget).toBe(TITLE);
  });

  it('ignores a value that has no comparable identity', () => {
    const ledger = new RevealLedger();
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    ledger.note(slot(), TITLE, 'Hello');
    const edit = slot();
    ledger.note(edit, TITLE, cyclic);
    expect(edit.revealTarget).toBeUndefined();
  });
});
