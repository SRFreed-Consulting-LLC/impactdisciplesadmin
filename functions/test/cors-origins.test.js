// The CORS allow-list is what restrictedCors enforces, so an origin dropped
// from it stops a real browser call - Print Label, checkout, the shipping
// quote. It has now been composed from ADMIN_APP_ORIGINS rather than written
// out by hand, and this file is what makes that refactor safe: the exact set
// is pinned here, so a future edit to either list cannot quietly remove one.
//
// It also pins the property that caused two separate incidents: the custom
// domain staff actually work from must be present. See ADMIN_APP_ORIGINS.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  CORS_ALLOWED_ORIGINS,
  ADMIN_APP_ORIGINS,
  APP_URLS,
  LOCAL_APP_URLS,
} = require("../lib/common/shared/config/firebase-projects");

/** Every origin restrictedCors allowed before ADMIN_APP_ORIGINS existed. */
const EXPECTED = [
  "https://impactdisciples.com",
  "https://www.impactdisciples.com",
  "https://impactdisciples-public.web.app",
  "https://impactdisciples-public.firebaseapp.com",
  "https://impactdisciplesdev-public.web.app",
  "https://impactdisciplesdev-public.firebaseapp.com",
  "https://admin.impactdisciples.com",
  "https://impactdisciples-admin.web.app",
  "https://impactdisciples-admin.firebaseapp.com",
  "https://impactdisciplesdev-admin.web.app",
  "https://impactdisciplesdev-admin.firebaseapp.com",
  "https://library.impactdisciples.com",
  "https://impactdisciples-library.web.app",
  "https://impactdisciples-library.firebaseapp.com",
  "https://impactdisciplesdev-library.web.app",
  "https://impactdisciplesdev-library.firebaseapp.com",
  "http://localhost:4200",
  "http://localhost:4201",
  "http://localhost:5200",
  "http://localhost:5201",
  "http://localhost:6200",
  "http://localhost:6201",
];

test("composing from ADMIN_APP_ORIGINS lost no origin", () => {
  for (const origin of EXPECTED) {
    assert.ok(
      CORS_ALLOWED_ORIGINS.includes(origin),
      `${origin} is no longer allowed - a browser call from it would be refused`
    );
  }
});

test("and added none by accident", () => {
  for (const origin of CORS_ALLOWED_ORIGINS) {
    assert.ok(
      EXPECTED.includes(origin),
      `${origin} was added to the CORS allow-list without being reviewed`
    );
  }
});

test("the custom domain staff actually use is an admin origin", () => {
  // Twice now the Firebase-assigned host was named and the connected domain
  // was not: CORS in September 2026, then the page previewer the next day.
  assert.ok(ADMIN_APP_ORIGINS.includes("https://admin.impactdisciples.com"));
  assert.ok(CORS_ALLOWED_ORIGINS.includes("https://admin.impactdisciples.com"));
});

test("every Firebase-assigned admin host is an origin too", () => {
  assert.ok(ADMIN_APP_ORIGINS.includes(APP_URLS.admin.prod));
  assert.ok(ADMIN_APP_ORIGINS.includes(APP_URLS.admin.dev));
});

test("local admin origins are present, so a dev previewer is trusted", () => {
  // The x201/x200 port rule: emulator-backed and live-data local servers.
  assert.ok(ADMIN_APP_ORIGINS.includes(APP_URLS.admin.emulator));
  assert.ok(ADMIN_APP_ORIGINS.includes(LOCAL_APP_URLS.admin));
});

test("no origin carries a path or a trailing slash", () => {
  // event.origin never has one, so an entry with either can never match.
  for (const origin of CORS_ALLOWED_ORIGINS) {
    assert.equal(origin, new URL(origin).origin,
      `${origin} is not a bare origin`);
  }
});

test("the list has no duplicates", () => {
  assert.equal(
    new Set(CORS_ALLOWED_ORIGINS).size,
    CORS_ALLOWED_ORIGINS.length,
    "a duplicated origin means two lists were merged carelessly"
  );
});
