/**
 * Schema-level extraction: open the config, find every collection and global,
 * walk into them. Lenient by design — a Payload config is a full TypeScript
 * program, so the common shapes are recognised and everything else becomes a
 * diagnostic rather than a silently empty type.
 */
import { Node, Project, SyntaxKind, type ObjectLiteralExpression, type SourceFile } from 'ts-morph';
import { extractFields } from './extract-field';
import { toPascalCase } from './names';
import {
  expandElements,
  hasProperty,
  propertyValue,
  readArrayProperty,
  readStringProperty,
  reportSkip,
  resolveToArrayLiteral,
  resolveToObjectLiteral,
  type ExtractContext,
} from './resolve';
import type { ExtractedSchema, ExtractedSlug } from './types';

export interface ExtractSchemaOptions {
  /** Absolute or relative path to `payload.config.ts`. */
  readonly configPath: string;
  /** When provided, used instead of constructing a fresh ts-morph project. */
  readonly project?: Project;
  /** A `tsconfig.json` whose module resolution lets cross-file imports be followed. */
  readonly tsConfigFilePath?: string;
}

function declaredValue(declaration: Node): Node | undefined {
  if (Node.isExportAssignment(declaration)) return declaration.getExpression();
  if (Node.isVariableDeclaration(declaration)) return declaration.getInitializer();
  return undefined;
}

function findConfigLiteral(
  sourceFile: SourceFile,
  context: ExtractContext,
): ObjectLiteralExpression | undefined {
  const defaultExport = sourceFile.getDefaultExportSymbol();
  if (defaultExport === undefined) {
    context.diagnostics.push('payload.config.ts has no default export.');
    return undefined;
  }
  for (const declaration of defaultExport.getDeclarations()) {
    const literal = resolveToObjectLiteral(declaredValue(declaration));
    if (literal !== undefined) return literal;
  }
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isIdentifier(callee) || callee.getText() !== 'buildConfig') continue;
    const literal = resolveToObjectLiteral(call.getArguments()[0]);
    if (literal !== undefined) return literal;
  }
  return undefined;
}

function extractSlugList(
  configLiteral: ObjectLiteralExpression,
  key: 'globals' | 'collections',
  context: ExtractContext,
): ExtractedSlug[] {
  const value = propertyValue(configLiteral, key);
  if (value === undefined) return [];
  const array = resolveToArrayLiteral(value);
  if (array === undefined) {
    reportSkip(context, value, `could not resolve \`${key}\` to an array literal`);
    return [];
  }
  const out: ExtractedSlug[] = [];
  for (const element of expandElements(array, context)) {
    const literal = resolveToObjectLiteral(element);
    if (literal === undefined) {
      reportSkip(context, element, 'could not resolve the config entry to an object literal');
      continue;
    }
    const slug = readStringProperty(literal, 'slug');
    if (slug === undefined) {
      reportSkip(context, element, 'the config entry has no string `slug`');
      continue;
    }
    const fields = readArrayProperty(literal, 'fields');
    if (fields === undefined) {
      reportSkip(
        context,
        literal,
        hasProperty(literal, 'fields')
          ? `the \`fields\` of "${slug}" could not be resolved to an array literal`
          : `"${slug}" has no \`fields\``,
      );
    }
    out.push({
      slug,
      typeName: toPascalCase(slug),
      fields: fields === undefined ? [] : extractFields(fields, context),
    });
  }
  return out;
}

export function extractSchema(options: ExtractSchemaOptions): ExtractedSchema {
  const project =
    options.project ??
    new Project(
      options.tsConfigFilePath !== undefined
        ? { tsConfigFilePath: options.tsConfigFilePath }
        : { skipAddingFilesFromTsConfig: true },
    );
  const sourceFile = project.addSourceFileAtPathIfExists(options.configPath);
  if (sourceFile === undefined) {
    return { globals: [], collections: [], diagnostics: [`Could not open ${options.configPath}`] };
  }
  project.resolveSourceFileDependencies();
  const context: ExtractContext = { diagnostics: [] };
  const configLiteral = findConfigLiteral(sourceFile, context);
  if (configLiteral === undefined) {
    return {
      globals: [],
      collections: [],
      diagnostics: [
        ...context.diagnostics,
        'Could not locate a buildConfig({...}) call or `export default {...}` in the config file.',
      ],
    };
  }
  const globals = extractSlugList(configLiteral, 'globals', context);
  const collections = extractSlugList(configLiteral, 'collections', context);
  return { globals, collections, diagnostics: context.diagnostics };
}
