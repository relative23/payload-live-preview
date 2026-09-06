/**
 * Reads the message objects Payload's admin *builds* out of their source, as
 * an AST walk rather than a grep.
 *
 * Anchoring on the `postMessage` call site would need a different amount of
 * machinery per release: 3.88 assigns the object to a `const` and passes the
 * identifier, `main` passes an inline literal into a `useCallback` wrapper.
 * This walk anchors on the protocol's own discriminator instead — every object
 * literal in the file carrying `type: 'payload-…'` — which both shapes satisfy
 * and which survives moving the literal around inside the component.
 *
 * What it does NOT see, and what therefore cannot be held here:
 *   - spreads and computed keys: reported as `unresolved`, so the gate goes red
 *     and a person looks, rather than the model quietly losing a field;
 *   - properties attached after construction (`message.x = y`);
 *   - a message built in some other file;
 *   - what the values mean. The walk records `mostRecentUpdate` as written, not
 *     that it is a `useState` nobody ever clears. That half is the corpus's.
 */

import { Node, Project, SyntaxKind, type ObjectLiteralExpression } from 'ts-morph';

/** The type alias in `packages/live-preview/src/types.ts` that declares the update. */
const DECLARED_ALIAS = 'LivePreviewMessageEvent';
const TYPE_PREFIX = 'payload-';

export interface SenderProperty {
  readonly name: string;
  /** The initializer exactly as written, e.g. `mostRecentUpdate` or `locale?.code`. */
  readonly sentAs: string;
}

export interface SenderMessage {
  /** The string literal on the `type` property. */
  readonly type: string;
  readonly properties: readonly SenderProperty[];
  /** Members the walk could not name: spreads and computed keys. */
  readonly unresolved: readonly string[];
}

export interface DeclaredProperty {
  readonly name: string;
  readonly optional: boolean;
  /** The declared type as written, e.g. `DocumentEvent`. */
  readonly type: string;
}

function literalType(object: ObjectLiteralExpression): string | undefined {
  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property) || property.getName() !== 'type') continue;
    const initializer = property.getInitializer();
    if (initializer === undefined || !Node.isStringLiteral(initializer)) continue;
    const value = initializer.getLiteralValue();
    return value.startsWith(TYPE_PREFIX) ? value : undefined;
  }
  return undefined;
}

/** Every message object the given source builds, in source order. */
export function readSenderMessages(path: string, source: string): readonly SenderMessage[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile(path, source);
  const messages: SenderMessage[] = [];
  for (const object of sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
    const type = literalType(object);
    if (type === undefined) continue;
    const properties: SenderProperty[] = [];
    const unresolved: string[] = [];
    for (const property of object.getProperties()) {
      if (Node.isShorthandPropertyAssignment(property)) {
        properties.push({ name: property.getName(), sentAs: property.getName() });
        continue;
      }
      if (!Node.isPropertyAssignment(property)) {
        unresolved.push(property.getText());
        continue;
      }
      const nameNode = property.getNameNode();
      if (!Node.isIdentifier(nameNode) && !Node.isStringLiteral(nameNode)) {
        unresolved.push(property.getText());
        continue;
      }
      properties.push({
        name: property.getName(),
        sentAs: property.getInitializer()?.getText() ?? '',
      });
    }
    messages.push({ type, properties, unresolved });
  }
  return messages;
}

/**
 * The update message as `types.ts` declares it — the only place the sender side
 * says which fields are optional. Hand-written, so it can lag the builder; a
 * disagreement between the two is a finding of its own.
 */
export function readDeclaredProperties(source: string): readonly DeclaredProperty[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('types.ts', source);
  const alias = sourceFile.getTypeAlias(DECLARED_ALIAS);
  if (alias === undefined) throw new Error(`${DECLARED_ALIAS} is no longer declared in types.ts`);
  const reference = alias.getTypeNodeOrThrow();
  if (!Node.isTypeReference(reference)) {
    throw new Error(`${DECLARED_ALIAS} is no longer a MessageEvent<…> reference`);
  }
  const literal = reference.getTypeArguments()[0];
  if (literal === undefined || !Node.isTypeLiteral(literal)) {
    throw new Error(`${DECLARED_ALIAS} no longer carries an inline payload type`);
  }
  const declared: DeclaredProperty[] = [];
  for (const member of literal.getMembers()) {
    if (!Node.isPropertySignature(member)) continue;
    declared.push({
      name: member.getName(),
      optional: member.hasQuestionToken(),
      type: member.getTypeNodeOrThrow().getText(),
    });
  }
  return declared;
}
