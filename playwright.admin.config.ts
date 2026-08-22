import { defineConfig, devices } from '@playwright/test';

// ADMIN-ONLY E2E over the Firebase emulator. The third Playwright config in
// this repo, and each has a different job:
//
//   playwright.config.ts        e2e/       live dev project, hand-run smoke
//   playwright.cross.config.ts  e2e-cross/ all three apps, cross-app flows
//   playwright.admin.config.ts  e2e-admin/ THIS - one app, one emulator
//
// This one exists because most admin breakage is single-app UI breakage
// (a route moved, a lazy chunk broke, a grid stopped rendering) and paying
// the cost of booting the web and reader dev servers to catch it is waste.
// It boots one server and runs the whole functional-area sweep.
//
// Prereq: `npm run emu` is up and `npm run emu:seed` has run. The suite is
// mostly read-only against the seeded world; the specs that write reseed
// themselves in beforeAll.
export default defineConfig({
  testDir: './e2e-admin',
  // Sequential: one shared emulator world, and the writing specs reseed.
  fullyParallel: false,
  workers: 1,
  // One retry so the dashboard can tell flaky (amber) from broken (red) -
  // a first-run failure that passes on retry is reported as flaky, not
  // laundered into a pass.
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['./e2e-admin/support/dashboard-reporter.ts'],
  ],
  use: {
    baseURL: 'http://localhost:5200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run start-emu',
    url: 'http://localhost:5200',
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
