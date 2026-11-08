import { defineConfig } from 'vitest/config';
// Pilot tests run separately so the root S1-S15 suite stays unchanged.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['pilot/tests/**/*.test.ts'],
  },
});
