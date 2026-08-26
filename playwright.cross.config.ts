import { defineConfig } from '@playwright/test';

// Cross-app E2E over the Firebase EMULATOR suite (test program Phases 3-4):
// flows that span the admin app and the public web app (and later the
// reader). Prereq: the emulator stack is running (`npm run emu` in this
// repo). Both dev servers are started here via webServer entries, each on
// its `emulator` build configuration - nothing in these runs can touch
// impactdisciplesdev or prod.
//
// That guarantee only became true on 2026-08-26. These webServer entries
// use reuseExistingServer, and until then the emulator servers bound the
// SAME ports as the dev-data ones (admin 5200, web 4200), so an already-
// running `start-local` would simply be adopted here and the whole suite
// would have run against impactdisciplesdev - the exact thing the sentence
// above promises cannot happen. Ports now encode the backend: the
// thousands digit is the app and the last digit is the backend, so x201 is
// always emulator (web 4201, admin 5201, reader 6201) and x200 is always
// live dev data. See APP_URLS in the shared submodule.
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
      url: 'http://localhost:5201',
      reuseExistingServer: true,
      timeout: 300_000,
    },
    {
      command: 'npm run start-emu',
      cwd: '../impactdisciples - web',
      url: 'http://localhost:4201',
      reuseExistingServer: true,
      timeout: 300_000,
    },
    {
      command: 'npm run start-emu',
      cwd: '../impact-discipleship-library-new',
      url: 'http://localhost:6201',
      reuseExistingServer: true,
      timeout: 300_000,
    },
  ],
});
