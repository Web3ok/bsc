import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{js,ts,tsx}'],
    exclude: ['node_modules', 'dist', 'frontend/node_modules'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        'frontend/',
        '**/*.d.ts',
        '**/*.config.{js,ts}',
        '**/cli/index.ts'
      ],
      reportsDirectory: './coverage'
    },
    timeout: 60000,
    testTimeout: 30000,
    hookTimeout: 10000,
    teardownTimeout: 10000,
    reporters: ['verbose'],
    outputFile: {
      json: './tests/test-results.json',
      junit: './tests/test-results.xml'
    }
  },
  resolve: {
    alias: {
      '@': './src'
    }
  }
});