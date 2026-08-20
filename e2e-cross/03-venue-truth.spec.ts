import { test, expect } from '@playwright/test';
import { WEB_URL } from './support/harness';

// Charter area: Events - venue snapshot truth across apps.
//
// The restructure's venue contract: an event at a single-site organization
// carries a `venue` snapshot of the org's own name + address, and the
// PUBLIC site renders that snapshot directly (organizations stays
// staff-only readable). The seeded "Fall Multiplication Workshop" is
// exactly that case - org Hope Fellowship, no location children.
//
// LIVE-RUN FINDING (2026-08, this suite), NOW FIXED: the public site's
// venue lines used to be gated on `@if (event?.location)` alone
// (event-details.component.html / events.component.html), and a
// single-site-org event has no `location` by design - so VenuePipe's
// snapshot-first path was unreachable for the very case it was built for.
// The gates are `venue || location` now; this spec asserts the fixed
// behavior (and would catch the gate regressing).
//
// No reseed here: this flow only READS seeded data, so it runs against
// whatever world the previous spec left (the seed is never mutated for
// event-workshop by other flows).
test.describe('venue snapshot renders on the public site', () => {
  test('event details renders the org-address venue snapshot for a single-site-org event', async ({ page }) => {
    await page.goto(`${WEB_URL}/event-details/event-workshop`);
    await expect(page.locator('body')).toContainText('Fall Multiplication Workshop');
    await expect(page.locator('body')).toContainText('A one-day workshop.');
    // The paid path renders the cart totals block (costInDollars = 10).
    await expect(page.locator('body')).toContainText('Ticket Price');
    // VenuePipe 'cityState' off the venue snapshot - the event has no
    // location child (single-site org), so this render IS the snapshot path.
    await expect(page.locator('body')).toContainText('Newnan, GA');
  });

  test('the summit page renders its pinned venue address from the snapshot', async ({ page }) => {
    await page.goto(`${WEB_URL}/summit/2027`);
    // The summit's name renders as the header image's alt (bound to the
    // event's own eventName - summit.component.html's summit__header img),
    // not as page text.
    await expect(page.getByAltText('Disciple-Making Summit 2027')).toBeVisible({ timeout: 20_000 });
    // VenuePipe 'address' PREFERS the venue snapshot (venue.pipe.ts) - the
    // summit carries one, so this address comes from the snapshot, not an
    // organizations read (that collection is staff-only; an anonymous
    // visitor rendering this proves the snapshot-first path).
    await expect(page.locator('body')).toContainText('Sharpsburg');
    await expect(page.locator('body')).toContainText('2564 Highway 16');
    // The event's own description (admin-authored) beats the hardcoded
    // fallback paragraph.
    await expect(page.locator('body')).toContainText('Two days of practical disciple-making training.');
  });
});
