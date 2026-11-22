import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  outputDir: process.env.CONTEXT_EDGE_BINARY ? 'test-results/edge' : 'test-results/chromium',
  fullyParallel: true,
  workers: 3,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 5_000 },
  reporter: 'list'
});
