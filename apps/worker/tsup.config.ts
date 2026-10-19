import { defineConfig } from 'tsup';
import configPkg from '../../packages/config/package.json' with { type: 'json' };

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  // Our workspace packages are TS source, so bundle them in...
  noExternal: [/^@support-agent\//],
  // ...but keep their npm dependencies external like every other package. Bundling CommonJS
  // libraries (e.g. dotenv) into ESM breaks their require() calls at runtime.
  external: Object.keys(configPkg.dependencies),
});
