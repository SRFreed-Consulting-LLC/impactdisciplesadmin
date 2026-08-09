import { defineConfig, devices } from '@playwright/test';

// Verification harness for the DevExtreme -> Material migration
// (migrate-from-devexpress branch). Tests assume `npm run start-local` is
// already running against a local dev server on port 5200 (this repo's
// standing house rule - NOT Angular's default 4200) - `webServer` is
// deliberately left unset rather than auto-starting `ng serve` here, since a
// cold Angular dev-server boot plus first-compile can take well past a
// reasonable spec timeout, and this repo's HMR server is often already
// running during active development anyway.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
