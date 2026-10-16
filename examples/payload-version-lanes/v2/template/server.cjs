/**
 * Only this process reads the ephemeral editor credentials and signing secret.
 * It owns a fresh run-specific Mongo database and seeds it through Payload's
 * local API; the browser must still log in through the real admin form.
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { redactor, diagnostic } = require('./diagnostics.cjs');

const settings = JSON.parse(readFileSync(process.env.PLP_P2_RUN_FILE, 'utf8'));
const redact = redactor(settings);
if (!/^plp_r4_p2_[a-z0-9_]+$/u.test(settings.database))
  throw new Error('Unexpected fixture database');
for (const key of Object.keys(process.env))
  if (key.startsWith('PAYLOAD_PUBLIC_')) delete process.env[key];
process.env.PAYLOAD_CONFIG_PATH = join(__dirname, 'payload.config.js');
process.env.PAYLOAD_PUBLIC_P2_ADMIN_ORIGIN = settings.admin;
process.env.PAYLOAD_PUBLIC_P2_SITE_ORIGIN = settings.site;
process.env.PAYLOAD_PUBLIC_P2_VARIANT = settings.variant;
process.env.PAYLOAD_PUBLIC_P2_SURFACE = settings.surface;
process.env.PLP_P2_MONGO_URL = `mongodb://127.0.0.1:${settings.mongoPort}/${settings.database}`;
process.env.NODE_ENV = 'development';

const express = require('express');
const payload = require('payload');
const app = express();
let ready = false;
app.get('/__plp_health', (_req, res) =>
  res.status(ready ? 200 : 503).json({
    ready,
    payload: '2.32.3',
    variant: settings.variant,
    csrf: payload.config?.csrf ?? [],
    serverURL: payload.config?.serverURL ?? '',
  }),
);
let server;
let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  // Only this process's listener and its connection to the fresh run database.
  if (server) await new Promise((done) => server.close(done));
  try {
    await payload.db?.destroy();
  } catch (error) {
    console.error(diagnostic(error, redact));
    code = 1;
  }
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void stop(0);
  });

async function main() {
  await payload.init({
    secret: settings.secret,
    express: app,
    loggerOptions: { level: 'warn' },
    onInit: async (cms) => {
      const existing = await cms.find({ collection: 'users', limit: 1, overrideAccess: true });
      if (existing.totalDocs !== 0) throw new Error('This run requires a fresh fixture database');
      await cms.create({
        collection: 'users',
        data: { email: settings.email, password: settings.password },
        overrideAccess: true,
      });
      await cms.create({
        collection: 'authors',
        data: { name: 'Ada Fixture' },
        overrideAccess: true,
      });
      await cms.create({
        collection: 'authors',
        data: { name: 'Grace Fixture' },
        overrideAccess: true,
      });
      await cms.updateGlobal({
        slug: 'homepage',
        overrideAccess: true,
        data: {
          title: 'Payload 2 seeded title',
          subtitle: 'Payload 2 seeded subtitle',
          author: null,
          tags: [{ label: 'alpha' }, { label: 'beta' }],
        },
      });
      if (settings.surface !== 'dom') {
        await cms.updateGlobal({
          slug: 'otherpage',
          overrideAccess: true,
          data: {
            title: 'Payload 2 other title',
            subtitle: 'Payload 2 other subtitle',
            author: null,
          },
        });
      }
      ready = true;
    },
  });
  server = app.listen(settings.adminPort, '127.0.0.1', () =>
    console.log('Payload 2 fixture listening on loopback'),
  );
}

main().catch((error) => {
  console.error('Payload 2 fixture initialization failed');
  console.error(diagnostic(error, redact));
  void stop(1);
});
