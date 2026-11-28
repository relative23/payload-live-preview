/**
 * A fresh project for a quickstart of the README: outside the repository, on
 * the packed archive, with the framework as the example's lockfile names it. The files come from the page itself (`quickstartFiles`), so
 * what a spec builds is what a reader would write.
 */
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNpmPackReport } from '../../../scripts/package-artifact';
import { initializeConsumer, installStrictly } from '../../../scripts/package-smoke-consumer';
import { detailFor, run } from '../../../scripts/package-smoke-support';
import { quickstartFiles } from '../../../scripts/quickstart-blocks';
import {
  PACKAGE_SMOKE_INSTALL_ARGS,
  sanitizeNpmScriptEnvironment,
} from '../../../scripts/release-contracts';
import { deriveArchiveConsumer } from './native-consumer';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface QuickstartProject {
  /** The temporary folder that holds everything; removing it removes the replay. */
  readonly root: string;
  /** The project a reader of the quickstart would have. */
  readonly project: string;
  readonly environment: NodeJS.ProcessEnv;
}

/**
 * A new project on the archive. With `example`, the project gets that
 * example's manifest and lockfile with the archive in place of the package, and
 * `npm ci` installs exactly what the lockfile names: the framework a reader
 * would install, at the version CI tests. Without it the archive is all there is.
 * `PLP_QUICKSTART_TARBALL` names an archive that is already packed, as the CI
 * job has one; without it the working tree is packed.
 */
export async function quickstartProject(
  name: string,
  example?: string,
): Promise<QuickstartProject> {
  const root = await mkdtemp(resolve(tmpdir(), `payload-live-preview-quickstart-${name}-`));
  const environment = sanitizeNpmScriptEnvironment(process.env);
  let tarball = process.env['PLP_QUICKSTART_TARBALL'];
  if (tarball === undefined) {
    const pack = run(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', root],
      REPOSITORY_ROOT,
      environment,
    );
    if (pack.status !== 0) throw new Error(`npm pack failed:\n${detailFor(pack)}`);
    tarball = resolve(root, parseNpmPackReport(pack.stdout).filename);
  }
  const project = resolve(root, 'project');
  if (example === undefined) {
    await initializeConsumer(project);
    const install = installStrictly(project, [resolve(tarball)]);
    if (install.status !== 0) throw new Error(`the install failed:\n${detailFor(install)}`);
    return { root, project, environment };
  }
  const source = resolve(REPOSITORY_ROOT, 'examples', example);
  const consumer = await deriveArchiveConsumer(source, resolve(tarball));
  await mkdir(project, { recursive: true });
  await writeFile(resolve(project, 'package.json'), JSON.stringify(consumer.manifest));
  await writeFile(resolve(project, 'package-lock.json'), JSON.stringify(consumer.lock));
  await copyFile(resolve(source, '.npmrc'), resolve(project, '.npmrc'));
  // As the production hosts install: the lockfile pins every byte, and a cold
  // runner has no cache, so the registry may be asked.
  const install = run(
    'npm',
    [
      'ci',
      ...PACKAGE_SMOKE_INSTALL_ARGS.filter(
        (argument) =>
          !['--omit=optional', '--offline', '--package-lock=false', '--no-save'].includes(argument),
      ),
      '--prefer-offline',
    ],
    project,
    environment,
  );
  if (install.status !== 0) throw new Error(`the install failed:\n${detailFor(install)}`);
  return { root, project, environment };
}

/** Write the files the quickstart under `heading` names, word for word; `append` adds to one of them. */
export async function writeQuickstart(
  project: string,
  heading: string,
  append: Readonly<Record<string, string>> = {},
): Promise<readonly string[]> {
  const files = quickstartFiles(
    await readFile(resolve(REPOSITORY_ROOT, 'README.md'), 'utf8'),
    heading,
  );
  for (const file of files) {
    const target = resolve(project, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${file.content}${append[file.path] ?? ''}`);
  }
  return files.map((file) => file.path);
}

/** Write the files a quickstart leaves to the project. */
export async function writeProjectFiles(
  project: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = resolve(project, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/**
 * A static host for the built site, with an admin at `/admin` that frames
 * `/`. Both are one origin, which is the origin the build is given as the
 * admin's.
 */
export async function serveSite(directory: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/admin') {
      response
        .writeHead(200, { 'content-type': TYPES['.html'] })
        .end(
          '<!doctype html><html><body><iframe data-testid="preview-frame" title="Live preview" ' +
            'src="/"></iframe></body></html>',
        );
      return;
    }
    const file = resolve(
      directory,
      `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`,
    );
    const inside = relative(directory, file);
    if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    readFile(file).then(
      (body) =>
        response
          .writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
          .end(body),
      () => response.writeHead(404).end('not found'),
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the host has no port');
  return { server, origin: `http://127.0.0.1:${String(address.port)}` };
}

export async function closeServer(server: Server | undefined): Promise<void> {
  await new Promise<void>((done) => (server === undefined ? done() : server.close(() => done())));
}

/** The cookie the mocked Payload takes for an editor's session. */
export const EDITOR_COOKIE = 'payload-token=quickstart-editor';
/** An admin origin for a server that is only asked over HTTP: a production build refuses an `http:` one. */
export const ADMIN_ORIGIN = 'https://cms.example.test';

/**
 * What the `payload-session` strategy asks Payload: `GET /api/users/me`. The
 * mock knows one editor by cookie and nobody else, and counts what it is asked.
 */
export async function mockPayload(): Promise<{ server: Server; origin: string; asked: string[] }> {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    asked.push(`${request.method ?? ''} ${request.url ?? ''}`);
    const editor = (request.headers.cookie ?? '').split(/;\s*/u).includes(EDITOR_COOKIE);
    response
      .writeHead(200, { 'content-type': TYPES['.json'] })
      .end(
        JSON.stringify(
          editor
            ? { user: { id: 'editor-1', collection: 'users' }, collection: 'users' }
            : { user: null },
        ),
      );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the mock has no port');
  return { server, origin: `http://127.0.0.1:${String(address.port)}`, asked };
}

/** A port nothing listens on right now. */
export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const address = probe.address();
  await closeServer(probe);
  if (address === null || typeof address === 'string') throw new Error('no free port');
  return address.port;
}

/** Start the project's own server and wait until it answers; `stop()` ends it. */
export async function startProjectServer(
  project: string,
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  origin: string,
): Promise<{ stop: () => Promise<void>; output: () => string }> {
  const child = spawn(command, args, { cwd: project, env: environment, stdio: 'pipe' });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const stop = async (): Promise<void> => {
    if (child.exitCode !== null) return;
    const ended = new Promise<void>((done) => child.once('exit', () => done()));
    child.kill('SIGTERM');
    await ended;
  };
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the server ended before it answered:\n${output}`);
    try {
      await fetch(origin, { redirect: 'manual' });
      return { stop, output: () => output };
    } catch {
      if (Date.now() > deadline) {
        await stop();
        throw new Error(`the server did not answer on ${origin}:\n${output}`);
      }
      await new Promise((done) => setTimeout(done, 250));
    }
  }
}

/** One request to the project, as a visitor or with the editor's cookie. */
export async function ask(
  url: string,
  editor: boolean,
): Promise<{ status: number; html: string; csp: string }> {
  const response = await fetch(url, {
    redirect: 'manual',
    headers: editor ? { cookie: EDITOR_COOKIE } : {},
  });
  return {
    status: response.status,
    html: await response.text(),
    csp: response.headers.get('content-security-policy') ?? '',
  };
}
