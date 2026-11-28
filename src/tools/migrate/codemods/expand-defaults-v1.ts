/**
 * Ledger entry 21: `defaults: 'v1'` → the rows it stood for, as explicit
 * options, where a reviewer and `pll doctor --v2` see each one (ADR 0026).
 * The rows keep the value the profile gave, with two exceptions that 3.0
 * cannot keep: `strict: false`, which it removed (entry 36), is not written,
 * and the preview signals are written without `'referer'`, which an adapter
 * refuses at startup.
 */
import type { Node, ObjectLiteralElementLike, ObjectLiteralExpression } from 'ts-morph';
import { loadTsMorph, propertyKey } from '../ast';
import {
  memberNamed,
  optionLiterals,
  packageJsxAttributes,
  type OptionsKind,
  type OptionsUse,
} from '../option-literals';
import type { CodemodImplementation, CodemodConflict, TextEdit } from '../types';
import { TURNED_SWITCHES } from './rename-disable-switches';

const ID = 'expand-defaults-v1';
const KEY = 'defaults';

/** The 1.x rows 3.0 can keep, in source form; `q` is the file's quote. */
const REQUEST_ROWS: readonly (readonly [string, (q: string) => string])[] = [
  ['previewSignals', (q) => `[${[`${q}query${q}`, `${q}fetch-dest${q}`].join(', ')}]`],
];
const RUNTIME_ROWS: readonly (readonly [string, (q: string) => string])[] = [
  ['enableReferrerDetection', () => 'true'],
  ['eventSourcePolicy', (q) => `${q}any${q}`],
  ['skipUnchanged', () => 'false'],
  ['sanitizerPolicy', (q) => `${q}compat${q}`],
];
const ROWS: Readonly<Record<OptionsKind, readonly (readonly [string, (q: string) => string])[]>> = {
  adapter: [...REQUEST_ROWS, ...RUNTIME_ROWS],
  runtime: RUNTIME_ROWS,
};
/** The 2.x name of a row, where it had another: a value the other codemod could not turn round still sets the row. */
const BEFORE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(TURNED_SWITCHES).map(([before, now]) => [now, before]),
);
const ROW_KEYS: ReadonlySet<string> = new Set(
  ROWS.adapter.flatMap(([key]) => [key, BEFORE[key] ?? key]),
);
const BY_HAND = "write the rows `defaults: 'v1'` stands for by hand (docs/migration.md)";

export const expandDefaultsV1: CodemodImplementation = {
  id: ID,
  summary: "`defaults: 'v1'` → the 1.x rows as explicit options",
  ledgerEntry: 21,
  notice:
    "The rows keep the 1.x values `defaults: 'v1'` gave, except two that 3.0 cannot keep: `strict: false` " +
    'is not written, so an adapter needs `authorizePreview` (docs/authorization.md), and `previewSignals` ' +
    "is written without 'referer'. `pll doctor --v2` names each of the other rows to drop once the page is ready for the default.",
  apply(script) {
    const { Node } = loadTsMorph();
    const edits: TextEdit[] = [];
    const conflicts: CodemodConflict[] = [];
    for (const [literal, uses] of optionLiterals(script)) {
      const property = memberNamed(literal, KEY);
      if (property === undefined) continue;
      const line = property.getStartLineNumber();
      const conflict = (reason: string): void => {
        conflicts.push({ codemod: ID, line, reason: `${reason}; ${BY_HAND}` });
      };
      const value = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
      if (value === undefined || !Node.isStringLiteral(value)) {
        conflict('`defaults` is not a literal');
        continue;
      }
      if (value.getLiteralText() !== 'v1') continue;
      const refusal = refuse(literal, property, uses);
      if (refusal !== undefined) {
        conflict(refusal);
        continue;
      }
      edits.push(expansion(literal, property, uses, value.getText().charAt(0)));
    }
    for (const attribute of packageJsxAttributes(script, KEY)) {
      conflicts.push({
        codemod: ID,
        line: attribute.getStartLineNumber(),
        reason: `a JSX attribute; ${BY_HAND} as attributes`,
      });
    }
    return { edits, conflicts };
  },
};

/** Why the rows cannot go where `defaults` was without changing what wins, if they cannot. */
function refuse(
  literal: ObjectLiteralExpression,
  property: Node,
  uses: readonly OptionsUse[],
): string | undefined {
  const { Node } = loadTsMorph();
  if (new Set(uses.map((use) => use.kind)).size > 1) {
    return 'the object is shared by an adapter and a client, which take different rows';
  }
  // A row is explicit once written, so whatever came before it no longer wins over it.
  const properties = literal.getProperties();
  const index = properties.findIndex((member) => member === property);
  if (properties.slice(0, index).some((member) => Node.isSpreadAssignment(member))) {
    return 'a spread before `defaults` may set a row the expansion would override';
  }
  for (const { outer, at } of uses) {
    if (at === undefined) continue;
    if (memberNamed(outer, KEY) !== undefined) {
      return 'a call that spreads it names its own defaults';
    }
    const before = outer.getProperties().slice(0, at);
    const overridden = (member: ObjectLiteralElementLike): boolean =>
      Node.isSpreadAssignment(member) || ROW_KEYS.has(propertyKey(member) ?? '');
    if (before.some(overridden)) {
      return 'a call sets a row before spreading the object, and the expansion would override it';
    }
  }
  return undefined;
}

function expansion(
  literal: ObjectLiteralExpression,
  property: Node,
  uses: readonly OptionsUse[],
  quote: string,
): TextEdit {
  const { Node } = loadTsMorph();
  const kind = uses[0]?.kind ?? 'runtime';
  const present = new Set(literal.getProperties().map((member) => propertyKey(member)));
  const composed = [literal, ...uses.map((use) => use.outer)];
  const has = (key: string): boolean =>
    composed.some((part) => memberNamed(part, key) !== undefined);
  // A spread the codemod cannot see into may carry `serverURL`; the one that brings this object in is seen.
  const known = new Set(
    uses.map((use) => (use.at === undefined ? undefined : use.outer.getProperties()[use.at])),
  );
  const opaque = composed.some((part) =>
    part.getProperties().some((member) => Node.isSpreadAssignment(member) && !known.has(member)),
  );
  const rows = ROWS[kind]
    .filter(([key]) => !present.has(key) && !present.has(BEFORE[key]))
    .map(([key, value]) => `${key}: ${value(quote)}`);
  // `'v1'` read an omitted depth as the 1.x default of 1; 2.0 asks for it with `serverURL`.
  if (!has('mergeDepth') && (has('serverURL') || opaque)) rows.push('mergeDepth: 1');
  const source = property.getSourceFile().getFullText();
  if (rows.length === 0) {
    // Every row is already explicit: only the key goes, with the separator after it.
    const next = literal.getProperties().find((member) => member.getStart() > property.getStart());
    return { start: property.getStart(), end: next?.getStart() ?? property.getEnd(), text: '' };
  }
  const lineStart = source.lastIndexOf('\n', property.getStart()) + 1;
  const lead = source.slice(lineStart, property.getStart());
  const separator = /^\s*$/u.test(lead) ? `,\n${lead}` : ', ';
  return { start: property.getStart(), end: property.getEnd(), text: rows.join(separator) };
}
