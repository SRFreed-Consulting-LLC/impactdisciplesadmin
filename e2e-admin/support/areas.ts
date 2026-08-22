// The FUNCTIONAL AREA registry for the admin E2E suite.
//
// The dashboard reports by area, not by spec file, because "Campaigns is
// red" is the sentence a person can act on and "03-campaign-email-editor
// line 82 failed" is not. Every spec file tags itself with one area id via
// test.describe's title prefix (see areaOf()), and the reporter groups
// results by that.
//
// `owns` is the plain-language answer to "what is broken for a user if this
// goes red" - it is printed verbatim on the dashboard card, so write it as
// a consequence, not as a component name.
//
// `layer` records where the truth for this area ACTUALLY lives. 'ui' means
// the browser is the thing under test and no other layer can see this
// break. 'ui+data' means this spec also asserts a Firestore/function
// outcome that has no integration-test coverage yet - the dashboard flags
// those as "should move down a layer", because an integration test would
// cover it faster and less flakily (see integration/ in this repo).

export interface FunctionalArea {
  id: string;
  title: string;
  owns: string;
  layer: 'ui' | 'ui+data';
  /** Set when an integration/ test already owns the data half of this area. */
  dataCoveredBy?: string;
}

export const AREAS: FunctionalArea[] = [
  {
    id: 'access',
    title: 'Access Control',
    owns: 'Staff signing in at all, and Employees being kept out of screens they were never granted.',
    layer: 'ui',
  },
  {
    id: 'campaigns',
    title: 'Campaigns',
    owns: 'Seeing campaigns, opening one, reading its funnel and timeline, and creating a new one.',
    layer: 'ui',
  },
  {
    id: 'campaign-email',
    title: 'Campaign Email Authoring',
    owns: 'Designing and scheduling a campaign email - the screen rewritten 2026-08-21.',
    layer: 'ui',
  },
  {
    id: 'email-history',
    title: 'Email History',
    owns: 'Reading what was actually sent, and getting from a sent email back to its campaign.',
    layer: 'ui',
  },
  {
    id: 'contacts',
    title: 'Contacts & Orders',
    owns: 'Finding a contact or a purchase, and servicing an order (fulfillment, refunds).',
    layer: 'ui',
    dataCoveredBy: 'integration/ store-to-fulfillment + customer upsert tests',
  },
  {
    id: 'store',
    title: 'Store Catalog',
    owns: 'The products, coupons and sales that the public web store sells.',
    layer: 'ui',
  },
  {
    id: 'library',
    title: 'Library Administration',
    owns: 'Reader accounts, license grants and revokes, and messages sent to patrons.',
    layer: 'ui',
    dataCoveredBy: 'integration/ + e2e-cross reader license lifecycle',
  },
  {
    id: 'events',
    title: 'Events & Registrations',
    owns: 'Events, who registered, and the session/breakout counts staff plan against.',
    layer: 'ui',
    dataCoveredBy: 'integration/ summit registration + session counts',
  },
  {
    id: 'content',
    title: 'Website Content',
    owns: 'Everything the public site renders from Firestore - DMM, podcasts, testimonials, team, home images.',
    layer: 'ui',
  },
  {
    id: 'tools',
    title: 'Tools & Reports',
    owns: 'System email templates, the form builder, and the reports staff pull numbers from.',
    layer: 'ui',
  },
];

export const AREA_BY_ID = new Map(AREAS.map((a) => [a.id, a]));

/**
 * Spec files title their top-level describe as `[area-id] Human Title`.
 * The reporter reads the id back out of the test's title path.
 */
export function areaOf(titlePath: string[]): FunctionalArea | undefined {
  for (const part of titlePath) {
    const m = /^\[([a-z-]+)\]/.exec(part.trim());
    if (m) return AREA_BY_ID.get(m[1]);
  }
  return undefined;
}
