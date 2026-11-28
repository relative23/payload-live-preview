/**
 * The files a quickstart of the README asks a project to write, word for word.
 * Every code block under "## Quick start" opens with a comment that names its
 * file (`// app/layout.tsx`), so the page itself is the source of a replay: a
 * snippet that stops working fails where it is read, not in a copy of it.
 */

export interface QuickstartFile {
  /** The path the block's first line names, relative to the project. */
  readonly path: string;
  /** The block as the page has it, the naming comment included. */
  readonly content: string;
}

const SECTION = '## Quick start';
const FENCE = /^```(\w*)\n([\s\S]*?)\n```$/gmu;
/** `// path`, optionally followed by a dash and a remark. */
const NAMED = /^\/\/ ([\w./[\]()+-]+\.\w+)(?: — .*)?$/u;

/** The text of one `### heading` inside the quick start, up to the next heading. */
function subsection(readme: string, heading: string): string {
  const start = readme.indexOf(`\n${SECTION}\n`);
  if (start === -1) throw new Error(`the README has no "${SECTION}" section`);
  const rest = readme.slice(start + SECTION.length + 2);
  const end = rest.search(/\n## /u);
  const section = end === -1 ? rest : rest.slice(0, end);
  const opening = `\n### ${heading}\n`;
  const at = section.indexOf(opening);
  if (at === -1) throw new Error(`the quick start has no "### ${heading}"`);
  const body = section.slice(at + opening.length);
  const next = body.search(/\n### /u);
  return next === -1 ? body : body.slice(0, next);
}

/**
 * The files of one quickstart, in the order of the page. A block that names no
 * file is an error: the replay could not place it, so the page has to say.
 */
export function quickstartFiles(readme: string, heading: string): readonly QuickstartFile[] {
  const files: QuickstartFile[] = [];
  for (const [, , content = ''] of subsection(readme, heading).matchAll(FENCE)) {
    const named = NAMED.exec(content.split('\n', 1)[0] ?? '');
    if (named?.[1] === undefined) {
      throw new Error(
        `a code block under "### ${heading}" does not open with a comment naming its file`,
      );
    }
    files.push({ path: named[1], content: `${content}\n` });
  }
  if (files.length === 0) throw new Error(`"### ${heading}" has no code block`);
  return files;
}
