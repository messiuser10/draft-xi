import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    include: ['test/**/*.test.ts'],
    // PGlite (in-process Postgres) needs a moment to boot its WASM runtime.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
