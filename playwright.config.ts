import { defineConfig, devices } from '@playwright/test';

// Verification harness for the DevExtreme -> Material migration
// (migrate-from-devexpress branch). Tests assume `npm run start-local` is
// already running against a local dev server on port 5200. That port is
// admin-on-live-dev-data by RULE (2026-08-26): the thousands digit is the
// app and the last digit is the backend - web 4200/4201, admin 5200/5201,
// reader 6200/6201, where x201 is the Firebase emulator. It matters here
// because this config names a bare port with no webServer to claim it:
// until that rule, `npm run start-emu` ALSO bound 5200, so these specs
// could silently run against emulator data (which has none of the dev
// records they assert on) purely because of what was already running. The
// emulator-backed sibling suites now live on 5201 and can never answer
// here. See APP_URLS in the shared submodule. `webServer` is
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
