import { defineConfig } from '@playwright/test';

// These tests drive the real chess.com, so they need a network connection.
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'e2e-report', open: 'never' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  outputDir: 'e2e-results',
});
