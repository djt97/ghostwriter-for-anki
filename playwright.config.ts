import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  // Give hooks + extension boot ample time on CI
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    viewport: { width: 1280, height: 800 },
    video: 'off',
    screenshot: 'off',
    trace: process.env.CI ? 'retain-on-failure' : 'off',
  },
});
