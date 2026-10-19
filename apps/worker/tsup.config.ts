import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  // npm packages stay external (installed on the host); our workspace packages are TS source, so bundle them.
  noExternal: [/^@support-agent\//],
});
