import { defineConfig } from '@playwright/test';

// Oberflächentests mit der echten Electron-App. Vorher muss `npm run build` gelaufen sein (test:e2e erledigt das).
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
});
