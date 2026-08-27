import { test, expect, Page } from '@playwright/test';
import { WEB_URL, firestoreOwnerFetch, reseedEmulator } from './support/harness';

// Charter area: THE FUNNEL, end to end - the one flow the owner asked for on
// 2026-08-25 and the one thing no other spec spans.
//
// The individual legs are already covered: 09 proves a campaign offer reaches
// the storefront price, 11 proves early-bird attribution changes what a
// visitor is shown, 02 proves a summit registration reaches the Command
// Centre. What none of them do is walk a single visitor from "a popup
// appeared" to "the campaign's counters moved", which is what a campaign is
// actually judged on.
//
// The chain, and where each link lives:
//
//   popup shown on /      campaign-popup.component.ts fires the
//                         campaign_web_event beacon           -> stats.webShown
//   CTA clicked           same beacon, type=web_click, then
//                         navigates to a ?cid=&csrc=popup url -> stats.webClicks
//   lands on the event    AttributionService reads the query
//                         string and keeps it for 30 days
//   registers             register_for_event ->
//                         recordCampaignConversion(
//                           type:'registration', via:'popup') -> stats.registrations
//
// WHERE THIS STOPS. Payment is deliberately out of scope. The PayPal button
// is PayPal's own SDK in an iframe that a human has to approve, so a capture
// cannot be driven from a browser at all - 13-paid-checkout ends at the same
// place, and capture itself is proven server-side in
// integration/vendor-money.test.js. The summit is a $0 registration anyway,
// which is what makes the whole funnel automatable.
//
// The popup is seeded here rather than in the fixture world on purpose: it is
// full-screen chrome that intercepts pointer events on every route, and
// seeding it globally would break the other cross-app specs the way it once
// broke eleven web specs (see impactdisciples - web/playwright.config.ts's
// storageState note).

const FS_BASE = 'http://localhost:8080/v1/projects/demo-impact/databases/(default)/documents';

const CAMPAIGN_ID = 'camp-funnel-cross';
const POPUP_ID = 'popup-funnel-cross';
const EVENT_ID = 'event-summit-2027';

const ATTENDEE = {
  firstName: 'Fern',
  lastName: 'Funnelton',
  email: `funnel-${Date.now().toString(36)}@cross.test`,
};

const str = (stringValue: string) => ({ stringValue });
const bool = (booleanValue: boolean) => ({ booleanValue });
const num = (n: number) => ({ integerValue: String(n) });
const ts = (ms: number) => ({ timestampValue: new Date(ms).toISOString() });

async function fsWrite(path: string, fields: unknown): Promise<void> {
  const res = await fetch(`${FS_BASE}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`seed ${path} failed: ${res.status} ${await res.text()}`);
}

/** The campaign's funnel counters, as numbers, defaulting to 0 when absent. */
async function stats(): Promise<Record<string, number>> {
  const { body } = await firestoreOwnerFetch(`campaigns/${CAMPAIGN_ID}`);
  const raw = body?.fields?.stats?.mapValue?.fields ?? {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries<Record<string, string>>(raw)) {
    out[k] = Number(v.integerValue ?? v.doubleValue ?? 0);
  }
  return out;
}

async function seedFunnel(): Promise<void> {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();

  // A LIVE campaign - campaign_web_event refuses to count for anything else,
  // and recordCampaignConversion refuses an id that does not exist.
  await fsWrite(`campaigns/${CAMPAIGN_ID}`, {
    name: str('Summit Funnel'),
    goal: str('event'),
    eventId: str(EVENT_ID),
    status: str('live'),
    channels: { arrayValue: { values: [str('web')] } },
    startDate: ts(now - DAY),
    endDate: ts(now + 365 * DAY),
    schemaVersion: num(2),
    stats: { mapValue: { fields: {
      sent: num(0), delivered: num(0), opens: num(0), uniqueOpens: num(0),
      clicks: num(0), uniqueClicks: num(0), purchases: num(0), revenue: num(0),
      registrations: num(0), subscribes: num(0), webShown: num(0), webClicks: num(0),
    } } },
  });

  // A LINK popup, so the primary button both counts a click and carries the
  // attribution to the event page. The url is ?cid-decorated exactly the way
  // the admin's popup editor emits it.
  await fsWrite(`campaign_popups/${POPUP_ID}`, {
    campaignId: str(CAMPAIGN_ID),
    isActive: bool(true),
    fromDate: ts(now - DAY),
    toDate: ts(now + 365 * DAY),
    title: str('Summit Funnel Popup'),
    html: str('<h3>Disciple-Making Summit</h3><p data-e2e="funnel-popup">Seats are open.</p>'),
    width: num(480),
    height: num(420),
    cta: { mapValue: { fields: {
      type: str('link'),
      primaryLabel: str('See the summit'),
      dismissLabel: str('Not now'),
      linkUrl: str(`/event-details/${EVENT_ID}?cid=${CAMPAIGN_ID}&csrc=popup`),
    } } },
  });
}

/** A visitor who has never been here: no dismissal, no impression guard. */
async function freshVisitor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch { /* storage unavailable */ }
  });
}

async function fillAttendee(page: Page): Promise<void> {
  const fields: [string, string][] = [
    ['#attendee-firstName-0', ATTENDEE.firstName],
    ['#attendee-lastName-0', ATTENDEE.lastName],
    ['#attendee-email-0', ATTENDEE.email],
  ];
  await expect(page.locator(fields[0][0])).toBeVisible({ timeout: 20_000 });
  // The form rebuilds itself as the event's async data lands and can wipe a
  // value typed into it mid-flight - 02-summit-registration hit the same
  // thing, so this re-fills until the values survive a settling period.
  await expect(async () => {
    for (const [selector, value] of fields) await page.locator(selector).fill(value);
    await page.waitForTimeout(1_500);
    for (const [selector, value] of fields) {
      await expect(page.locator(selector)).toHaveValue(value, { timeout: 1_000 });
    }
  }).toPass({ timeout: 45_000 });
}

test.describe('[funnel] Popup to registration', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    reseedEmulator();
    await seedFunnel();
  });

  test('the popup appears to a first-time visitor and counts an impression', async ({ page }) => {
    expect((await stats()).webShown).toBe(0);

    await freshVisitor(page);
    await page.goto(WEB_URL);

    await expect(page.locator('[data-e2e="funnel-popup"]')).toBeVisible({ timeout: 30_000 });

    // The beacon is fire-and-forget, so poll rather than assume it has landed.
    await expect.poll(async () => (await stats()).webShown, { timeout: 20_000 }).toBe(1);
  });

  test('the impression is counted once per visitor, not once per visit', async ({ page }) => {
    // A RETURNING visitor: one who has already been counted. The component
    // guards web_shown behind a per-popup localStorage key exactly so that
    // coming back cannot inflate the number, and an inflated impression count
    // is worse than a missing one - it makes a campaign look like it reached
    // people it never reached.
    //
    // Deliberately NOT freshVisitor() here: clearing storage is what makes the
    // beacon fire, so using it would test the opposite of the claim.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('campaign-popup-shown-popup-funnel-cross', '1');
      } catch { /* storage unavailable */ }
    });

    await page.goto(WEB_URL);
    // The popup still SHOWS - the guard is on the beacon, not on rendering,
    // and "don't show again" is a separate key nobody has set.
    await expect(page.locator('[data-e2e="funnel-popup"]')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3_000);

    expect((await stats()).webShown).toBe(1);
  });

  test('clicking the CTA counts a click and carries attribution to the event', async ({ page }) => {
    expect((await stats()).webClicks).toBe(0);

    await freshVisitor(page);
    await page.goto(WEB_URL);
    await expect(page.locator('[data-e2e="funnel-popup"]')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'See the summit' }).click();

    await expect(page).toHaveURL(new RegExp(`event-details/${EVENT_ID}`), { timeout: 30_000 });
    expect(page.url()).toContain(`cid=${CAMPAIGN_ID}`);
    expect(page.url()).toContain('csrc=popup');

    await expect.poll(async () => (await stats()).webClicks, { timeout: 20_000 }).toBe(1);
  });

  test('registering through that link credits the campaign', async ({ page }) => {
    expect((await stats()).registrations).toBe(0);

    await freshVisitor(page);
    // Arrive the way the popup sends a visitor - AttributionService reads the
    // query string at bootstrap and keeps it, which is what the registration
    // then submits.
    await page.goto(`${WEB_URL}/event-details/${EVENT_ID}?cid=${CAMPAIGN_ID}&csrc=popup`);
    await fillAttendee(page);

    const response = page.waitForResponse((r) => r.url().includes('register_for_event'), { timeout: 30_000 });
    await page.getByRole('button', { name: 'Sign UP' }).click();
    expect((await response).ok()).toBeTruthy();

    // recordCampaignConversion is best-effort by contract - it must never fail
    // the registration that carried it - so it lands after the response.
    await expect.poll(async () => (await stats()).registrations, { timeout: 25_000 }).toBe(1);
  });

  test('the funnel reads end to end on the campaign', async () => {
    const s = await stats();

    // TWO impressions, not one, and that is the correct number. Three
    // different people walked through these tests: the visitor in the first
    // test who only looked, the returning visitor in the second who was
    // deliberately not re-counted, and the visitor in the third who looked and
    // then clicked. Two of them were seeing the popup for the first time.
    //
    // The shape is the point - a funnel narrows. More people see a popup than
    // click it, and more click it than register. If these three ever came back
    // equal, something is counting the same person twice.
    expect(s.webShown).toBe(2);
    expect(s.webClicks).toBe(1);
    expect(s.registrations).toBe(1);
    expect(s.webShown).toBeGreaterThanOrEqual(s.webClicks);
    expect(s.webClicks).toBeGreaterThanOrEqual(s.registrations);

    // Nothing in this flow is a purchase or a subscribe, and a counter moving
    // that should not have is as much a bug as one that did not move.
    expect(s.purchases).toBe(0);
    expect(s.subscribes).toBe(0);
  });
});
