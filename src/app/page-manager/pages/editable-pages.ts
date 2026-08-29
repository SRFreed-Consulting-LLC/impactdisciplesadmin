/**
 * Every public page whose words and pictures staff can edit, and which
 * slots each one has.
 *
 * ONE list drives both the Page Manager nav entries and which fields each
 * editor screen shows. Adding a page is an entry here plus the matching
 * keys in its web template.
 *
 * A SLOT KEY IS A CONTRACT with the web template, which asks for it by name
 * and falls back to its own hardcoded copy when it is missing. Renaming a
 * key orphans whatever staff typed under the old one, so the admin never
 * offers to edit a key - only its contents.
 *
 * EVERY FIELD LISTED HERE IS ACTUALLY BOUND in the web template. That is a
 * rule, not an aspiration: a field that quietly does nothing is worse than
 * no field, because staff cannot tell it from one that is simply not
 * showing yet. Where a page has copy that is NOT editable, the slot's hint
 * says so rather than the catalogue offering a box for it.
 *
 * WHAT IS DELIBERATELY NOT HERE. Page STRUCTURE: which blocks a page has
 * and where they sit stays in the template. Staff change what a page says;
 * changing what a page IS stays a deploy. Same line the Coaching with
 * Impact page drew on 2026-08-29.
 *
 * Also not here: anything already editable somewhere else. Prices come from
 * Web Config (the equipping pages interpolate webConfig.equippingGroup*),
 * podcasts from YouTube + Web Config, e-books and the store from Products,
 * events from Events Manager, team from Team Page, testimonials from
 * Testimonials, privacy and terms from Web Config. Duplicating any of those
 * would create a second source of truth for a value that already has one.
 */

export interface PageSlotFields {
  heading?: boolean;
  /** Rich text. One block holds a whole passage - see PageContentModel. */
  body?: boolean;
  image?: boolean;
  cta?: boolean;
  items?: boolean;
}

export interface PageSlot {
  key: string;
  label: string;
  hint?: string;
  fields: PageSlotFields;
}

export interface EditablePage {
  /** Firestore doc id AND the public route slug. */
  slug: string;
  /** Nav label in Page Manager. Must match the nav-config leaf's label. */
  label: string;
  /** Where it is on the public site, shown so staff can go and check. */
  path: string;
  blurb: string;
  slots: PageSlot[];
}

/** Heading only - the copy under it is a list or is not editable. */
const headingOnly = (key: string, label: string, hint?: string): PageSlot =>
  ({ key, label, hint, fields: { heading: true } });

const prose = (key: string, label: string, hint?: string): PageSlot =>
  ({ key, label, hint, fields: { heading: true, body: true } });

const LIST_HINT = 'The list under this heading is not editable yet - only the heading itself.';

export const EDITABLE_PAGES: readonly EditablePage[] = [
  {
    slug: 'about-us',
    label: 'About Us',
    path: '/about-us',
    blurb: 'The three story columns, the history and mission blocks, and the countries banner.',
    slots: [
      { key: 'story-1', label: 'Story - first column', fields: { heading: true, body: true, cta: true, image: true } },
      { key: 'story-2', label: 'Story - second column', fields: { heading: true, body: true, cta: true, image: true } },
      { key: 'story-3', label: 'Story - third column', fields: { heading: true, body: true, cta: true, image: true } },
      headingOnly('history', 'History banner',
        'The band across the middle. Only its heading is editable; the dated timeline below it stays in the site.'),
      prose('mission', 'Our mission'),
      prose('countries-count', 'Countries banner - the figure',
        'The heading is the number itself; the copy is the label under it.'),
      { key: 'countries-copy', label: 'Countries banner - the copy beside it', fields: { body: true } }
      // The dated TIMELINE is deliberately absent. It is a bespoke
      // alternating layout with year overlays, and the slot model has
      // nowhere to put a year - flattening it into cards would lose the
      // design. It stays in the web template.
    ]
  },
  {
    slug: 'equipping-groups',
    label: 'Equipping Groups',
    path: '/equipping-groups',
    blurb: 'The overview beside the video, and the three course cards.',
    slots: [
      prose('overview', 'Overview'),
      { key: 'courses', label: 'Course cards',
        hint: 'One card per course. "Goes to" is the page it links to.',
        fields: { heading: true, items: true } }
    ]
  },
  {
    slug: 'equipping-groups-pastors',
    label: 'Equipping - Pastors',
    path: '/equipping-groups-pastors',
    blurb: 'The Pastors course page. Prices come from Web Config.',
    slots: [
      prose('overview', 'Overview'),
      prose('basics', 'Equipping basics'),
      { key: 'cost', label: 'Cost',
        hint: 'The amounts themselves come from Web Config. The button below them is here.',
        fields: { heading: true, body: true, cta: true } },
      prose('pitch', 'Are you ready?'),
      prose('experience', 'What you will experience')
    ]
  },
  {
    slug: 'equipping-groups-leaders',
    label: 'Equipping - Leaders',
    path: '/equipping-groups-leaders',
    blurb: 'The Leaders course page. Prices come from Web Config.',
    slots: [
      prose('overview', 'Overview'),
      headingOnly('basics', 'Equipping basics', LIST_HINT),
      headingOnly('cost', 'Cost', 'The amounts come from Web Config.'),
      headingOnly('pitch', 'Are you ready?', LIST_HINT),
      headingOnly('priorities', 'Six priorities', LIST_HINT),
      headingOnly('includes', 'What this includes', LIST_HINT),
      headingOnly('audience', 'Who this is for', LIST_HINT)
    ]
  },
  {
    slug: 'equipping-groups-churches',
    label: 'Equipping - Churches',
    path: '/equipping-groups-churches',
    blurb: 'The Churches course page. Prices come from Web Config.',
    slots: [
      prose('overview', 'Overview'),
      headingOnly('getstarted', 'Get started', LIST_HINT),
      headingOnly('cost', 'Cost', 'The amounts come from Web Config.'),
      headingOnly('pitch', 'An online equipping experience', LIST_HINT),
      headingOnly('includes', 'What this includes', LIST_HINT),
      headingOnly('audience', 'Who this is for', LIST_HINT)
    ]
  },
  {
    slug: 'seminars',
    label: 'Seminars',
    path: '/seminars',
    blurb: 'The overview above the prices, and the What You Get heading.',
    slots: [
      prose('overview', 'Overview'),
      headingOnly('whatyouget', 'What you get', LIST_HINT)
    ]
  },
  {
    slug: 'lunch-and-learns',
    label: 'Lunch and Learns',
    path: '/lunch-and-learns',
    blurb: 'The overview, and the What You Get heading.',
    slots: [
      prose('overview', 'Overview'),
      headingOnly('whatyouget', 'What you get', LIST_HINT)
    ]
  },
  {
    slug: 'give',
    label: 'Give',
    path: '/give',
    blurb: 'The wording of the three giving options.',
    slots: [
      // NO cta fields on this page, deliberately. The three buttons open
      // hosted payment pages from environment.{oneGift,monthlyGift,
      // impactPartnersGift}Url. A mistyped or substituted URL in an
      // editable field would send donations somewhere else, and no amount
      // of staff gating makes that a good field to expose. Where a giving
      // button GOES stays a deploy.
      headingOnly('onetime', 'One-time gift', 'The button and where it goes stay in the site.'),
      headingOnly('monthly', 'Monthly gift', 'The button and where it goes stay in the site.'),
      prose('partners', 'Impact Partners', 'The button and where it goes stay in the site.')
    ]
  },
  {
    slug: 'contact',
    label: 'Contact',
    path: '/contact',
    blurb: 'The two headings. The address block comes from the site details, and the form is built in Form Builder.',
    slots: [
      headingOnly('intro', 'Above the address block'),
      headingOnly('form', 'Above the form')
    ]
  },
  {
    slug: 'discipleship-library',
    label: 'Discipleship Library',
    path: '/discipleship-library',
    blurb: 'The reader-app landing page: its hero and its closing block.',
    slots: [
      prose('hero', 'Hero', 'The Open the Library button stays in the site.'),
      prose('closing', 'Start reading today')
      // The FEATURE ROWS are absent: each carries its own video or
      // screenshot and a left/right alternation flag, which the slot model
      // has nowhere to put.
    ]
  },
  {
    slug: 'prayer-team',
    label: 'Prayer Team',
    path: '/prayer-team',
    blurb: 'The line above the signup form.',
    slots: [
      headingOnly('hero', 'Above the form')
    ]
  }
  // PODCASTS is deliberately absent. Inspecting the template rather than
  // trusting the survey: every string on it already comes from somewhere
  // editable - the header's three platform links from Web Config, the
  // episode list and titles from YouTube - so an editor here would have had
  // nothing to bind to but an empty box.
];

export function pageFor(slug: string): EditablePage | undefined {
  return EDITABLE_PAGES.find((page) => page.slug === slug);
}
