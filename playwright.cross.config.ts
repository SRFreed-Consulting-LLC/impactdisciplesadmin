import { defineConfig } from '@playwright/test';

// Cross-app E2E over the Firebase EMULATOR suite (test program Phases 3-4):
// flows that span the admin app and the public web app (and later the
// reader). Prereq: the emulator stack is running (`npm run emu` in this
// repo). Both dev servers are started here via webServer entries, each on
// its `emulator` build configuration - nothing in these runs can touch
// impactdisciplesdev or prod.
//
// Sequential on purpose (workers: 1, fullyParallel: false): the flows share
// one seeded emulator world; spec files reseed in their beforeAll when they
// need a pristine state (see e2e-cross/support/harness.ts), and a reseed
// wipes Auth - so ordering matters and parallel files would corrupt each
// other.
export default defineConfig({
  testDir: './e2e-cross',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Emulator trigger latency makes some assertions legitimately slow.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run start-emu',
      url: 'http://localhost:5200',
      reuseExistingServer: true,
      timeout: 300_000,
    },
    {
      command: 'npm run start-emu',
      cwd: '../impactdisciples - web',
      url: 'http://localhost:4200',
      reuseExistingServer: true,
      timeout: 300_000,
    },
    {
      command: 'npm run start-emu',
      cwd: '../impact-discipleship-library-new',
      url: 'http://localhost:4300',
      reuseExistingServer: true,
      timeout: 300_000,
    },
  ],
});
