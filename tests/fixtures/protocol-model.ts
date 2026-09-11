/**
 * The model of Payload's live-preview protocol: for every field the admin puts
 * on the wire, what it *is* — and what this runtime must therefore do with it.
 *
 * A `.ts` file rather than the `.json` the plan sketched, for the reason Z10's
 * exception book and Z12's delivery table are `.ts`: each row carries prose, a
 * named holder and — where today's behaviour is a known defect — an exception
 * with the task that removes it. In JSON that is an untyped bag of strings; here
 * the compiler holds the shape and the exception book cannot lose its task.
 *
 * The point of the file is the second half of each row. LP-1 shipped because
 * `externallyUpdatedRelationship` was in every capture, in the type, and in the
 * runtime — and nobody had written down that it repeats. A field that is there
 * is not the same as a field that means what its name says.
 */

/** Where the admin builds each message; `scripts/payload-sender-source.ts` fetches them. */
export const WINDOW_SOURCE = 'packages/ui/src/elements/LivePreview/Window/index.tsx';
export const TYPES_SOURCE = 'packages/live-preview/src/types.ts';

export interface ProtocolField {
  readonly name: string;
  /**
   * The initializer spellings the admin is known to use, as written. Held, not
   * merely reported: where a field's value comes from *is* its meaning, and a
   * new spelling is the moment to re-read the row below it. Two entries where
   * the channels differ (3.x writes `locale.code`, 4.x `locale?.code`).
   */
  readonly sentAs: readonly string[];
  /** As `types.ts` declares it. `undefined` where the type says nothing. */
  readonly optional: boolean | undefined;
  /** What it holds on the wire — not what the name suggests. */
  readonly meaning: string;
  /** What this runtime must therefore do with it. */
  readonly treatment: string;
  /** The gate or suite that holds `treatment`; an npm script or a file path. */
  readonly heldBy: string;
}

export interface ProtocolMessage {
  readonly type: string;
  readonly fields: readonly ProtocolField[];
}

export const PROTOCOL_MODEL: readonly ProtocolMessage[] = [
  {
    type: 'payload-live-preview',
    fields: [
      {
        name: 'type',
        sentAs: ["'payload-live-preview'"],
        optional: false,
        meaning:
          'The only discriminator on the wire. There is no version, no schema and no ' +
          'sender identity; a preview knows what it received from this string and the ' +
          'origin of the event, and from nothing else.',
        treatment:
          'Route on type plus exact origin. Never infer the kind of a message from its ' +
          'shape — an unknown type is ignored, not guessed at.',
        heldBy: 'scripts/check-protocol-drift.ts',
      },
      {
        name: 'data',
        sentAs: ['values'],
        optional: false,
        meaning:
          'The whole form, reduced from form state on every keystroke — never a diff. ' +
          'The admin fills in `id` when the form carries none, so a document that has ' +
          'not been saved still arrives with one.',
        treatment:
          'Diff against the previous message. The presence of a field says nothing ' +
          'about whether it changed, so nothing may be written because it is present.',
        heldBy: 'tests/integration/wire-corpus.test.ts',
      },
      {
        name: 'collectionSlug',
        sentAs: ['collectionSlug'],
        optional: true,
        meaning:
          'Set when a collection document is being edited. Editing a global leaves it ' +
          '`undefined`, and `undefined` does not survive the recording — the field is ' +
          'simply absent from the 3.88 corpus.',
        treatment:
          'Exactly one of the two slugs is meaningful; a missing one is not a protocol ' +
          'error and must not reject the message.',
        heldBy: 'tests/integration/wire-corpus.test.ts',
      },
      {
        name: 'globalSlug',
        sentAs: ['globalSlug'],
        optional: true,
        meaning: 'The mirror of `collectionSlug`, set when a global is being edited.',
        treatment: 'As `collectionSlug`: never require both, never reject on absence.',
        heldBy: 'tests/integration/wire-corpus.test.ts',
      },
      {
        name: 'locale',
        sentAs: ['locale.code', 'locale?.code'],
        optional: true,
        meaning:
          "The admin's current locale code. Absent on a single-locale install. 3.x " +
          'reads `locale.code` unguarded, 4.x guards it — the same value either way.',
        treatment:
          'Remember the last locale seen. A message that omits it continues the ' +
          'previous one; it does not reset the preview to no locale.',
        heldBy: 'tests/integration/wire-corpus.test.ts',
      },
      {
        name: 'externallyUpdatedRelationship',
        sentAs: ['mostRecentUpdate'],
        optional: true,
        meaning:
          'Not what the name says. It is `useDocumentEvents().mostRecentUpdate` — a ' +
          'plain `useState` in `providers/DocumentEvents`, written by `views/Edit` on ' +
          'every save of the document being edited, including this one, and never ' +
          'cleared. So it is `null` in every message until the first save and then set, ' +
          'to the same value, in every message for the rest of the session. It is a ' +
          'level, not an edge, and it usually names the previewed document itself. A ' +
          'global carries no `id`; identity there is `entitySlug` plus `updatedAt`.',
        treatment:
          'Derive an identity that does not require `id`, and act only when that ' +
          'identity changes AND names a document other than the previewed one. It must ' +
          'not force a re-render and must not emit an event per keystroke.',
        heldBy: 'npm run test:protocol-semantics',
      },
    ],
  },
  {
    type: 'payload-document-event',
    fields: [
      {
        name: 'type',
        sentAs: ["'payload-document-event'"],
        optional: false,
        meaning:
          'The whole message: a bare `{ type }` with no id and no slug, posted from a ' +
          'second effect keyed on the same `mostRecentUpdate`, so it accompanies the ' +
          'same saves.',
        treatment:
          'Read it as "the server has new truth", nothing more. No field may be read ' +
          'off it, and it must not be mistaken for an update carrying data.',
        heldBy: 'tests/integration/wire-corpus.test.ts',
      },
    ],
  },
];

/**
 * A task that can delete an exception. An exception naming none is itself a
 * defect, so this is the vocabulary `SEMANTIC_EXCEPTIONS` may draw on — and it
 * is empty today because that book is. Z1 stood here until it landed; whoever
 * writes the next exception writes its task in beside it.
 */
export const TASKS_THAT_REMOVE_EXCEPTIONS: Readonly<Record<string, string>> = {};

export interface SemanticException {
  readonly field: string;
  /** The audit finding this is, e.g. `LP-1`. */
  readonly finding: string;
  /** The task that removes it; a key of `TASKS_THAT_REMOVE_EXCEPTIONS`. */
  readonly task: string;
  readonly observed: string;
}

/**
 * Empty, and that is a result rather than an oversight: LP-1 stood here from the
 * day this file was written until Z1 bound `forceRender` to the event instead of
 * to the field being non-empty. The two rows it hung on now measure the fixed
 * behaviour, and an exception left standing over a fixed defect would make the
 * gate say something untrue about the runtime.
 */
export const SEMANTIC_EXCEPTIONS: readonly SemanticException[] = [];

/** What one replay of a corpus through the real runtime yields. */
export interface SemanticMeasurement {
  /** Update messages whose `externallyUpdatedRelationship` is non-empty. */
  readonly carrying: number;
  /** Distinct identities (`entitySlug` + `id` + `updatedAt`) among those. */
  readonly distinctDocuments: number;
  /** `relationshipUpdate` events the runtime emitted. */
  readonly relationshipUpdates: number;
  /**
   * Bindings skipped as unchanged from the first carrying message onward — the
   * delta, not the total. The total is dominated by the pre-save half of a
   * recording and would hide exactly the half this gate is about.
   */
  readonly skippedAfterSave: number;
}

export type SemanticMetric = keyof SemanticMeasurement;

export interface SemanticBudget {
  /** The corpus version this row measures. */
  readonly corpus: string;
  readonly metric: SemanticMetric;
  /** Today's number. Ratcheted in both directions, as Z11 and Z12 ratchet theirs. */
  readonly exactly: number;
  /** Why it is this number, and what would move it. */
  readonly reason: string;
  /** Set when today's number is a known defect; names a `SemanticException` finding. */
  readonly exception?: string;
}

/**
 * The semantics, as numbers a run can produce.
 *
 * The first two rows of each corpus describe the *recording*, not the runtime:
 * they are what makes "a capture must cross a save" permanent. A re-recording
 * that never saves puts `carrying` at 0 and turns this gate red — which is the
 * whole reason LP-1 was invisible for two releases.
 */
export const SEMANTIC_BUDGETS: readonly SemanticBudget[] = [
  {
    corpus: '3.85.0',
    metric: 'carrying',
    exactly: 0,
    reason:
      'A single message from a session that never saved. This corpus cannot see LP-1 ' +
      'at all, and the 0 says so out loud instead of leaving the gap invisible. It is ' +
      'kept as the 3.85 wire shape; the 3.88 rows carry the save.',
  },
  {
    corpus: '3.85.0',
    metric: 'distinctDocuments',
    exactly: 0,
    reason: 'Follows from `carrying`: no message names a document.',
  },
  {
    corpus: '3.85.0',
    metric: 'relationshipUpdates',
    exactly: 0,
    reason: 'No event can fire from a field that is `null` in the only message.',
  },
  {
    corpus: '3.85.0',
    metric: 'skippedAfterSave',
    exactly: 0,
    reason: 'No save in this session, so there is no "after" to measure.',
  },
  {
    corpus: '3.88.0',
    metric: 'carrying',
    exactly: 4,
    reason:
      'The four messages the panel posted after the save. Recording this needs a save ' +
      'in `tests/real-payload/record-wire-corpus.spec.ts`; a recorder that stops ' +
      'saving drops this to 0 and the run is red.',
  },
  {
    corpus: '3.88.0',
    metric: 'distinctDocuments',
    exactly: 1,
    reason:
      'All four name the same document — the previewed global itself, same ' +
      '`updatedAt`, byte for byte. That one number against the four above is LP-1 in ' +
      'the recording rather than in a report.',
  },
  {
    corpus: '3.88.0',
    metric: 'relationshipUpdates',
    exactly: 0,
    reason:
      'Four messages carry the field and none of them is an event, because all four ' +
      'name the previewed document itself and Z1 requires a different one. The 0 is ' +
      'held against the 4 above it: the level is still repeated in every message, and ' +
      'a runtime that goes back to reading it as an edge reads 4 here again.',
  },
  {
    corpus: '3.88.0',
    metric: 'skippedAfterSave',
    exactly: 8,
    reason:
      'Eight writes the post-save messages no longer make. Each of those messages ' +
      'leaves at least one bound field untouched — one repeats its predecessor whole — ' +
      'and `skipUnchanged` now stays on across the save, so the untouched ones are ' +
      'skipped as they are before it. This is the number that falls back to 0 if a ' +
      'save ever turns unconditional re-rendering on again.',
  },
];

export interface ProtocolViolation {
  readonly what: string;
  readonly detail: string;
}

/** Every field name the model holds, by message type. */
function modelled(type: string): readonly ProtocolField[] {
  return PROTOCOL_MODEL.find((message) => message.type === type)?.fields ?? [];
}

export interface ObservedMessage {
  readonly type: string;
  readonly properties: readonly { readonly name: string; readonly sentAs: string }[];
  readonly unresolved: readonly string[];
}

export interface ObservedField {
  readonly name: string;
  readonly optional: boolean;
}

/**
 * The form half: what the admin builds against what is written down here.
 *
 * `declared` is `types.ts` and may be empty for a channel whose alias moved;
 * an empty list is reported by the caller, not silently accepted here.
 */
export function findFormViolations(
  observed: readonly ObservedMessage[],
  declared: readonly ObservedField[],
): readonly ProtocolViolation[] {
  const violations: ProtocolViolation[] = [];
  for (const message of observed) {
    for (const member of message.unresolved) {
      violations.push({
        what: `${message.type} has a member this walk cannot name`,
        detail: `${member} — a spread or computed key; read the source before trusting the model`,
      });
    }
    const fields = modelled(message.type);
    if (fields.length === 0) {
      violations.push({
        what: `${message.type} is a message type the model does not hold`,
        detail: message.properties.map((property) => property.name).join(', '),
      });
      continue;
    }
    for (const property of message.properties) {
      const field = fields.find((candidate) => candidate.name === property.name);
      if (field === undefined) {
        violations.push({
          what: `${message.type}.${property.name} is sent but not modelled`,
          detail: `sent as \`${property.sentAs}\` — add it to PROTOCOL_MODEL with its meaning`,
        });
        continue;
      }
      if (!field.sentAs.includes(property.sentAs)) {
        violations.push({
          what: `${message.type}.${property.name} is filled from somewhere else now`,
          detail: `\`${property.sentAs}\`, not ${field.sentAs.map((s) => `\`${s}\``).join(' or ')} — re-read what it means, then record it`,
        });
      }
    }
    for (const field of fields) {
      if (message.properties.some((property) => property.name === field.name)) continue;
      violations.push({
        what: `${message.type}.${field.name} is modelled but no longer sent`,
        detail: field.meaning,
      });
    }
  }
  for (const type of PROTOCOL_MODEL) {
    if (observed.some((message) => message.type === type.type)) continue;
    violations.push({
      what: `${type.type} is modelled but the sender no longer builds it`,
      detail: WINDOW_SOURCE,
    });
  }
  const update = modelled('payload-live-preview');
  for (const field of declared) {
    const modelledField = update.find((candidate) => candidate.name === field.name);
    if (modelledField === undefined) {
      violations.push({
        what: `${field.name} is declared in types.ts but not modelled`,
        detail: TYPES_SOURCE,
      });
      continue;
    }
    if (modelledField.optional !== field.optional) {
      violations.push({
        what: `${field.name} changed optionality`,
        detail: `types.ts says optional=${field.optional}, the model says ${String(modelledField.optional)}`,
      });
    }
  }
  return violations;
}

/** The exception book itself: an exception without a task is a defect in the gate. */
export function findExceptionViolations(): readonly ProtocolViolation[] {
  const violations: ProtocolViolation[] = [];
  for (const exception of SEMANTIC_EXCEPTIONS) {
    if (!(exception.task in TASKS_THAT_REMOVE_EXCEPTIONS)) {
      violations.push({
        what: `exception ${exception.finding} names no task that removes it`,
        detail: exception.task,
      });
    }
    const fields = PROTOCOL_MODEL.flatMap((message) => message.fields);
    if (!fields.some((field) => field.name === exception.field)) {
      violations.push({
        what: `exception ${exception.finding} names a field the model does not hold`,
        detail: exception.field,
      });
    }
    if (!SEMANTIC_BUDGETS.some((budget) => budget.exception === exception.finding)) {
      violations.push({
        what: `exception ${exception.finding} describes no measurement`,
        detail: 'an exception that no budget row carries can never be removed by a green run',
      });
    }
  }
  for (const budget of SEMANTIC_BUDGETS) {
    if (budget.exception === undefined) continue;
    if (SEMANTIC_EXCEPTIONS.some((exception) => exception.finding === budget.exception)) continue;
    violations.push({
      what: `${budget.corpus} ${budget.metric} claims exception ${budget.exception}`,
      detail: 'no such finding in SEMANTIC_EXCEPTIONS',
    });
  }
  return violations;
}

/** The semantics half: what a replay produced against what is written down. */
export function findSemanticViolations(
  corpus: string,
  measurement: SemanticMeasurement,
): readonly ProtocolViolation[] {
  const violations: ProtocolViolation[] = [];
  for (const budget of SEMANTIC_BUDGETS.filter((row) => row.corpus === corpus)) {
    const actual = measurement[budget.metric];
    if (actual === budget.exactly) continue;
    // Direction, but no verdict: these metrics do not share a polarity. Fewer
    // `relationshipUpdates` is the fix; more `skippedAfterSave` is the same fix.
    const side = actual > budget.exactly ? 'above' : 'below';
    const exception =
      budget.exception === undefined
        ? ''
        : ` This row carries exception ${budget.exception}; ` +
          `${SEMANTIC_EXCEPTIONS.find((row) => row.finding === budget.exception)?.task ?? '?'} ` +
          'removes it, and deletes the exception in the same commit.';
    violations.push({
      what: `${corpus} ${budget.metric} ${actual}: ${side} the ${budget.exactly} written down — re-measure and record it here`,
      detail: budget.reason + exception,
    });
  }
  return violations;
}
