import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// npm dependencies of our shared packages (packages/*), e.g. mongoose, bullmq, the AWS SDK.
const packagesDir = new URL('../../packages/', import.meta.url);
const sharedPackageDeps = readdirSync(packagesDir).flatMap((dir) => {
  const pkg = JSON.parse(readFileSync(new URL(`${dir}/package.json`, packagesDir), 'utf8'));
  return Object.keys(pkg.dependencies ?? {});
});

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  // Our workspace packages are TS source, so bundle them in...
  noExternal: [/^@support-agent\//],
  // ...but keep their npm dependencies external like every other package. Bundling CommonJS
  // libraries (e.g. dotenv) into ESM breaks their require() calls at runtime.
  external: sharedPackageDeps,
});
