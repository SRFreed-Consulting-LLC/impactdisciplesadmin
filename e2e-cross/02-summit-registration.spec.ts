import { test, expect, Page } from '@playwright/test';
import { ADMIN_URL, WEB_URL, loginAsAdmin, reseedEmulator } from './support/harness';

// Charter area: Events / Summit - public registration through to the admin
// Command Center's capacity + assignment machinery.
//
// Reseeds in beforeAll (BEFORE any login - a reseed wipes Auth): every
// assertion below is an absolute count over the seeded world (30
// registrations, breakout A at 10/30, C FULL at 2/2, 10 no-breakout
// registrants), so a pristine world is genuinely required.

const FN_BASE = 'http://127.0.0.1:5001/demo-impact/us-central1';

// lastName deliberately sorts FIRST in the attendees table (paged orderBy
// lastNameLower DESC - event-attendees.component.ts; seeded lastnames are
// Zulu01..30, and "zz..." > "zulu" code-point-wise), so the new registrant
// is always on page 1.
const ATTENDEE = { firstName: 'Zara', lastName: 'Zztester', email: 'zztester@summit.test' };

let registrationId: string;

/**
 * Fills the attendee form and does not return until the values have SURVIVED
 * a settling period.
 *
 * This is working around a real product fragility, not just test timing.
 * event-details.component.ts subscribes to eventService.streamById() - a LIVE
 * Firestore listener - and rebuilds attendeesForm from scratch inside the
 * subscribe callback (`this.attendeesForm = this.fb.array([...])`, ~line 87).
 * So ANY later emission on that event document silently discards whatever the
 * visitor has typed. In the emulator a second emission reliably lands a beat
 * after the page settles; in production the same thing happens whenever staff
 * touch the event while someone is filling the form in.
 *
 * The failure is invisible where it happens: fill() succeeds, the values are
 * wiped, "Sign UP" then does nothing because the form is invalid, and the
 * test dies 30s later waiting for a request that was never going to be sent.
 * Diagnosed 2026-08-26 from the failure snapshot - all three fields empty,
 * all three "is required" errors showing.
 *
 * Filling once and asserting once is not enough (that was the first attempt,
 * and it still failed): the wipe can land AFTER the assertion. So fill, hold,
 * and re-check - and refill if the hold failed.
 */
async function fillAttendeeAndSettle(
  page: Page,
  attendee: { firstName: string; lastName: string; email: string },
): Promise<void> {
  const fields: Array<[string, string]> = [
    ['#attendee-firstName-0', attendee.firstName],
    ['#attendee-lastName-0', attendee.lastName],
    ['#attendee-email-0', attendee.email],
  ];

  await expect(page.locator(fields[0][0])).toBeVisible({ timeout: 20_000 });

  await expect(async () => {
    for (const [selector, value] of fields) {
      await page.locator(selector).fill(value);
    }
    // Hold long enough for a pending rebuild to land, then verify all three
    // are still there. If a rebuild wiped them, toPass re-runs the fill.
    await page.waitForTimeout(1_500);
    for (const [selector, value] of fields) {
      await expect(page.locator(selector)).toHaveValue(value, { timeout: 1_000 });
    }
  }).toPass({ timeout: 45_000 });
}

async function fnPost(name: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test.describe.configure({ mode: 'serial' });

test.describe('summit registration to command-center assignment', () => {
  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000); // wipe-first reseed is legitimately slow
    reseedEmulator();
  });

  test('the public summit page registers a new attendee', async ({ page }) => {
    await page.goto(`${WEB_URL}/summit/2027`);
    // The summit's name renders as the header image's alt text (bound to
    // the event's own eventName - summit.component.html), not as page text.
    await expect(page.getByAltText('Disciple-Making Summit 2027')).toBeVisible({ timeout: 20_000 });

    // "REGISTER NOW" routerLinks to /event-details/<id>
    // (summit.component.html's summit__register-button).
    await page.getByRole('link', { name: 'REGISTER NOW' }).click();
    await expect(page).toHaveURL(/event-details\/event-summit-2027/);

    // Attendee 1's fields (event-details.component.html:
    // #attendee-firstName-0 / #attendee-lastName-0 / #attendee-email-0).
    // The summit is $0, so the free "Sign UP" path renders (total === 0).
    //
    // NOTE: the web registration flow itself has NO breakout-selection
    // step - breakout signup lives behind the confirmation email's
    // schedule link, not the registration form - so no breakout is picked
    // web-side here; the admin assigns one in the next test (per charter).
    await fillAttendeeAndSettle(page, ATTENDEE);

    const responsePromise = page.waitForResponse((r) => r.url().includes('register_for_event'), { timeout: 30_000 });
    // Async validators (check_registration_exists + duplicate check) are
    // awaited by signUpForEvent() itself, so clicking straight away is safe.
    await page.getByRole('button', { name: 'Sign UP' }).click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    registrationId = (await response.json()).registrationId;
    expect(registrationId).toBeTruthy();

    // Web toast (toast.service.ts renders role="status" .impact-toast).
    await expect(page.locator('.impact-toast')).toContainText('Registered Successfully');
  });

  test('the Command Center shows 31 registrations, assigns a breakout, and reflects capacity truth', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${ADMIN_URL}/events-manager?tab=summit`);

    // Summit rows carry the 'hub' COMMAND CENTER row action
    // (events.component.ts rowActions; data-grid.component.html renders
    // row actions as icon buttons - selected by the mat-icon ligature).
    const summitRow = page.locator('tr', { hasText: 'Disciple-Making Summit 2027' });
    await expect(summitRow).toBeVisible({ timeout: 30_000 });
    await summitRow.locator('button:has(mat-icon:text-is("hub"))').click();

    // Registrations card (summit-command-center.component.html): 30 seeded
    // + the web registration above = 31.
    const regCard = page.locator('section.card', { hasText: 'Registrations' });
    await expect(regCard.locator('.card__big')).toHaveText('31', { timeout: 30_000 });

    // Before any assignment: seeded 10 no-breakout + the new attendee = 11.
    await expect(page.getByText(/11 registrant\(s\) haven't picked breakouts/)).toBeVisible();

    // The attendee table (app-event-attendees with sessionManagement) -
    // the new registrant's row carries the event_seat BREAKOUTS action.
    const attendeeRow = page.locator('tr', { hasText: ATTENDEE.email });
    await expect(attendeeRow).toBeVisible();
    await attendeeRow.locator('button:has(mat-icon:text-is("event_seat"))').click();

    // Session-assignment dialog (session-assignment-dialog.component.html):
    // one .opt row per breakout option; ASSIGN on a non-full option.
    const dialog = page.locator('mat-dialog-container', { hasText: 'BREAKOUTS — Zara Zztester' });
    await expect(dialog).toBeVisible();

    // Capacity truth inside the dialog before assigning: A 10/30, C FULL 2/2
    // (its row offers ADD TO QUEUE instead of ASSIGN).
    const optA = dialog.locator('.opt', { hasText: 'Making Disciples at Work' });
    const optC = dialog.locator('.opt', { hasText: 'Church Planting Panel' });
    await expect(optA).toContainText('10 / 30');
    await expect(optC).toContainText('2 / 2');
    await expect(optC).toContainText('FULL');
    await expect(optC.getByRole('button', { name: 'ADD TO QUEUE' })).toBeVisible();

    await optA.getByRole('button', { name: 'ASSIGN' }).click();
    // The option flips to REMOVE once the Firestore write lands, and the
    // capacity count ticks LIVE to 11/30. (LIVE-RUN FINDING, since fixed:
    // host.assign() used to mutate only the registration object handed up
    // by the paged attendee table - a different instance than the one in
    // the Command Center's aggregate `registrations` array that
    // countsByItemId() recomputes over - so this count silently stayed 10
    // until a full REFRESH. mutateSessions() now updates the canonical
    // instance too; this assertion guards the regression.)
    await expect(optA.getByRole('button', { name: 'REMOVE' })).toBeVisible();
    await expect(optA).toContainText('11 / 30');
    // exact:true - the popup header's X is aria-labelled "Close" too.
    await dialog.getByRole('button', { name: 'CLOSE', exact: true }).click();

    // True reload (the Registrations card's refresh icon button,
    // summit-command-center.component.html) - then the capacity bars
    // (.cap rows) show 11/30 for A, and C still FULL at 2/2.
    await regCard.locator('button:has(mat-icon:text-is("refresh"))').click();
    await expect(regCard.locator('.card__big')).toHaveText('31', { timeout: 30_000 });
    const capA = page.locator('.cap', { hasText: 'Making Disciples at Work' });
    const capC = page.locator('.cap', { hasText: 'Church Planting Panel' });
    await expect(capA).toContainText('11 / 30');
    await expect(capC).toContainText('FULL');
    await expect(capC).toContainText('2 / 2');

    // Reminder affordance: the new attendee now HAS a breakout, so the
    // no-breakout audience is back to the seeded 10 (registrants 21-30).
    await expect(page.getByText(/10 registrant\(s\) haven't picked breakouts/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'SEND REMINDER' })).toBeVisible();
  });

  test('the public session counters converge on the admin-assigned pick', async () => {
    // NOTE (nearest observable truth, production untouched): the web
    // schedule page (/events/:event-id/registrations/:registration-id,
    // schedule.component.ts) loads its event via
    // eventService.streamAllByValue('id', eventId) - a query on an `id`
    // FIELD that only exists on docs saved at least once through the apps'
    // own update() path (FirebaseDAO.update setDoc's the whole model, id
    // included). The fixture event docs are seeded without that field, so
    // the schedule view never becomes visible for seeded events and the
    // attendee-facing "your breakout renders as picked" assertion is not
    // drivable here. Instead this pins the same truth the schedule page
    // itself renders capacity from: the get_session_counts endpoint
    // (event-registration.functions.ts), which must converge to 11 for
    // "Making Disciples at Work" once the counter trigger drains.
    const deadline = Date.now() + 60_000;
    let counts: Record<string, number> = {};
    for (;;) {
      const res = await fnPost('get_session_counts', { eventId: 'event-summit-2027' });
      expect(res.status).toBe(200);
      counts = res.body.counts;
      if (counts['agenda-breakout-a'] === 11) break;
      if (Date.now() > deadline) {
        throw new Error(`session counts never reached 11 for breakout A: ${JSON.stringify(counts)}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    expect(counts['agenda-breakout-a']).toBe(11);
    expect(counts['agenda-breakout-b']).toBe(8);
    expect(counts['agenda-breakout-c']).toBe(2);

    // The registration created web-side is the one the admin assigned -
    // its server-side record carries the session (registration id is the
    // credential; same endpoint the emailed schedule link uses).
    const reg = await fnPost('get_event_registration', { registrationId });
    expect(reg.status).toBe(200);
    expect(reg.body.registration.email).toBe(ATTENDEE.email);
    expect(reg.body.registration.trainingSessions).toContain('agenda-breakout-a');
  });
});
