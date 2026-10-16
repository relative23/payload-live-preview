import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPayload } from '@payloadcms/next/withPayload';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // This example nests under the library repo, which has its own lockfile;
  // pin the workspace root so Turbopack doesn't warn about ambiguity.
  turbopack: { root: dirname },
};

export default withPayload(nextConfig);
