/**
 * The Stryker runner may only differ from the repository Vitest config in its
 * reporters: an independent include/exclude there would silently mutate against
 * a different test selection than the one CI enforces.
 */

import { Node, Project, SyntaxKind } from 'ts-morph';

function propertyName(node: Node): string | undefined {
  if (Node.isPropertyAssignment(node) || Node.isShorthandPropertyAssignment(node)) {
    return node.getName();
  }
  return undefined;
}

export function findStrykerVitestConfigViolations(
  strykerSource: string,
  vitestSource: string,
): readonly string[] {
  const violations: string[] = [];
  if (!/configFile:\s*['"]vitest\.stryker\.config\.ts['"]/u.test(strykerSource)) {
    violations.push('Stryker must use vitest.stryker.config.ts');
  }

  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('vitest.stryker.config.ts', vitestSource);
  const importsBase = sourceFile
    .getImportDeclarations()
    .some((declaration) => declaration.getModuleSpecifierValue() === './vitest.config');
  if (!importsBase) violations.push('dedicated config must import the base Vitest config');

  const defineCall = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((call) => call.getExpression().getText() === 'defineConfig');
  const root = defineCall?.getArguments()[0];
  if (root === undefined || !Node.isObjectLiteralExpression(root)) {
    return [...violations, 'dedicated config must export defineConfig with an object'];
  }

  const rootKeys = root.getProperties().map((property) => {
    if (Node.isSpreadAssignment(property)) return `...${property.getExpression().getText()}`;
    return propertyName(property) ?? '<unsupported>';
  });
  if (rootKeys.length !== 2 || !rootKeys.includes('...base') || !rootKeys.includes('test')) {
    violations.push('dedicated config may only inherit base and override test reporters');
  }

  const testProperty = root
    .getProperties()
    .find((property) => Node.isPropertyAssignment(property) && property.getName() === 'test');
  const testObject =
    testProperty !== undefined && Node.isPropertyAssignment(testProperty)
      ? testProperty.getInitializer()
      : undefined;
  if (testObject === undefined || !Node.isObjectLiteralExpression(testObject)) {
    return [...violations, 'dedicated config must override a test object'];
  }

  const testKeys = testObject.getProperties().map((property) => {
    if (Node.isSpreadAssignment(property)) return `...${property.getExpression().getText()}`;
    return propertyName(property) ?? '<unsupported>';
  });
  if (
    testKeys.length !== 2 ||
    !testKeys.includes('...base.test') ||
    !testKeys.includes('reporters')
  ) {
    violations.push('dedicated config test override may only replace reporters after base.test');
  }

  const reporters = testObject
    .getProperties()
    .find((property) => Node.isPropertyAssignment(property) && property.getName() === 'reporters');
  if (
    reporters === undefined ||
    !Node.isPropertyAssignment(reporters) ||
    reporters.getInitializer()?.getText() !== "['default']"
  ) {
    violations.push('dedicated config must use only the default reporter');
  }
  return violations;
}
