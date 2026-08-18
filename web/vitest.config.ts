import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // The scoring suite is environment-free; only the UI tests need a DOM, and
    // they opt in with the `@vitest-environment jsdom` docblock.
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
});
