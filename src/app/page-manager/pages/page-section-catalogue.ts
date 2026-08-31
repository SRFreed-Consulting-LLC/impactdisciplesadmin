import { PAGE_SECTION_TYPES } from '@impact-common/shared/lists/page_section_types.enum';
import { SECTION_ARCHETYPE, SectionSurface } from '@impact-common/shared/lists/section_kit';

/**
 * EVERY public page, as an ordered stack of sections staff can edit.
 *
 * ONE list drives all eleven screens: the Page Manager nav entries, each
 * page's Add menu, every row's icon and label, and which fields the pop-up
 * editor shows. Adding a page is an entry here plus a nav-config leaf; adding
 * a section type to a page is a line in that page's `kinds`.
 *
 * IT NO LONGER DESCRIBES THE PREVIEW. Each kind used to carry a `preview`
 * shape naming which miniature band to draw, because the previewer was a
 * drawing of the site. It frames the real page now (2026-08-29), so those
 * declarations described nothing and are gone - and with them the whole class
 * of bug where a drawing quietly stopped matching what it drew.
 *
 * WHAT A `type` IS. It names a section SHAPE, not a page. `mission` is copy
 * beside a click-to-play video wherever it appears - but it is a dark band on
 * About Us and a light two-up on the equipping pages, because every page has
 * its own section component in the web app. So this file can share a
 * vocabulary without forcing a shared look, and the same kind can carry
 * different LABELS per page: `heading` is "Title" on a hero and "The number"
 * on the countries figure.
 *
 * WHAT IS DELIBERATELY NOT EDITABLE, and why each one:
 *
 *   - WHERE A GIVING BUTTON GOES. The three buttons open hosted payment
 *     pages. An option names one of them by key and the site resolves it; a
 *     free-text URL would let anyone who can edit content redirect donations.
 *   - WHICH FORM a form section shows. It is a Firestore document id. An id
 *     retyped into a text box is a blank widget nobody can diagnose. The
 *     words around the form are editable; the form is built in Form Builder.
 *   - PRICES. They come from Web Config. A price line names the figure it
 *     wants and the site resolves it, so there is one number, not two.
 *   - THE POSTAL ADDRESS, phone, email and social links. They come from the
 *     site details, which already feed the footer and every other page.
 *   - THE READER APP'S ADDRESS. It is where a sibling application lives, not
 *     marketing copy.
 *
 * Also not here: anything already editable somewhere else. Podcasts come from
 * YouTube + Web Config, e-books and the store from Products, events from
 * Events Manager, team from Team Page, testimonials from Testimonials,
 * privacy and terms from Web Config. A second source of truth for a value
 * that already has one is worse than no editor at all.
 */

/** Which of a block's own fields a type uses. */
export interface PageSectionFields {
  heading?: boolean;
  subheading?: boolean;
  body?: boolean;
  note?: boolean;
  image?: boolean;
  cta?: boolean;
  /** A second button. Only a hero has one. */
  cta2?: boolean;
  video?: boolean;
  entries?: boolean;
  /**
   * Which quotes this section shows, and in what order.
   *
   * ORDER ONLY. The quotes themselves - their words, who said them, and
   * whether they appear at all - are administered on the Testimonials screen,
   * because a testimonial is not the property of any one page showing it.
   */
  testimonials?: boolean;
  /**
   * WHICH Form Builder form this section shows - a mat-select over the forms
   * that EXIST, storing the picked id. KIT PAGES ONLY: on the twelve original
   * pages the id stays in the page component. The original rule's rationale
   * ("an id retyped into a text box is a blank widget nobody can diagnose")
   * survives intact - nothing is ever typed. Approved 2026-08-30.
   */
  form?: boolean;
  /** WHICH mailing list a sign-up section joins - a fixed two-option choice
   *  (SIGNUP_LISTS), stored by key. Same pattern as the giving buttons. */
  signupList?: boolean;
}

/** Which of an ENTRY's fields a type uses. One control edits every kind of
 *  list, so a type only has to say which columns of it to show. */
export interface EntryFields {
  image?: boolean;
  title?: boolean;
  heading?: boolean;
  description?: boolean;
  body?: boolean;
  link?: boolean;
  /** Left or right, for a two-column block. */
  column?: boolean;
  /** A figure from Web Config. The amount itself is never editable. */
  amount?: boolean;
  icon?: boolean;
  cta?: boolean;
  /** One of the ministry's payment pages, chosen from a list. */
  giving?: boolean;
}

export interface EntrySpec {
  /** What one of these is called, e.g. "course", "entry", "price". */
  noun: string;
  /** The sentence above the list, explaining any rule the page applies. */
  note?: string;
  /**
   * What each side reads as, where the page alternates entries by position:
   * [what an even-numbered entry does, what an odd one does].
   *
   * Present means the editor SHOWS the derived side beside each entry. It
   * has to: an order that silently flips which side a photo sits on looks
   * like a bug until you know it is the rule, and hiding a layout rule makes
   * the order look like it does not matter.
   */
  sideLabels?: readonly [string, string];
  /** The page draws a counted "01/02" chip, so the editor shows it too. */
  numbered?: boolean;
  fields: EntryFields;
  titleLabel?: string;
  headingLabel?: string;
  descriptionLabel?: string;
  bodyLabel?: string;
  linkLabel?: string;
  imageLabel?: string;
}

/**
 * ONE selectable look within a kind, for pages drawn by the SECTION KIT.
 *
 * The twelve original pages do not use these and never will: each has its own
 * web component, so a difference in layout was expressed by giving the section
 * a different TYPE. A staff-created page has no component, so the same
 * difference has to be a choice on the section itself.
 *
 * A variant carries its own `fields` and `entry` because that is exactly what
 * differs - a price tile and a picture tile are the same archetype with
 * different columns. The editor reads them through the same getters it
 * already used for a kind, so nothing else in it had to change.
 */
export interface KindVariant {
  /** Stored in PageContentBlock.variant. Never renamed once in use. */
  key: string;
  label: string;
  blurb: string;
  fields: PageSectionFields;
  entry?: EntrySpec;
}

export interface PageSectionKind {
  type: PAGE_SECTION_TYPES | SECTION_ARCHETYPE;
  label: string;
  /** What it draws, in a phrase. The Add menu shows it under the label,
   *  because "Banner" alone does not tell staff which band is which. */
  blurb: string;
  icon: string;
  /** At most one of these may sit on the page. */
  singleton: boolean;
  fields: PageSectionFields;
  entry?: EntrySpec;
  headingLabel?: string;
  subheadingLabel?: string;
  bodyLabel?: string;
  imageLabel?: string;
  noteLabel?: string;
  ctaLabel?: string;
  cta2Label?: string;
  /** Shown at the top of the dialog where a type has something staff need to
   *  know before editing - what this screen will NOT change. */
  caveat?: string;

  /**
   * The looks staff may choose between. KIT PAGES ONLY - undefined on all
   * twelve original pages, which is what keeps them unaffected.
   *
   * When present, the FIRST is the default, and the editor reads its `fields`
   * and `entry` in place of the kind's own.
   */
  variants?: readonly KindVariant[];

  /**
   * The grounds this section may be drawn on. KIT PAGES ONLY.
   *
   * Undefined means the section has no say and takes the page's theme - which
   * is every section on the twelve original pages, whose colours are decided
   * by their own stylesheets.
   */
  surfaces?: readonly SectionSurface[];
}

export interface EditablePage {
  /** Firestore doc id AND the public route slug. */
  slug: string;
  /** Nav label in Page Manager. Must match the nav-config leaf's label. */
  label: string;
  /** Where it is on the public site, shown so staff can go and check. */
  path: string;
  blurb: string;
  /**
   * True where the stack reads LEFT TO RIGHT rather than top to bottom.
   *
   * Only Contact, which is one row of two halves. The screen says so rather
   * than letting staff drag a row up and wonder why nothing moved.
   */
  horizontal?: boolean;
  kinds: PageSectionKind[];
}

// ------------------------------------------------------------ pick lists

/** The figures a price line can name. Their VALUES live in Web Config. */
export const WEB_CONFIG_AMOUNTS: readonly { key: string; label: string }[] = [
  { key: 'equippingGroupTotalCost', label: 'Equipping group — full payment' },
  { key: 'equippingGroupPaymentCost', label: 'Equipping group — monthly plan' },
  { key: 'inpersonSeminarCost', label: 'Seminar — in person' },
  { key: 'onlineSeminarCost', label: 'Seminar — online video training' }
];

/** Where a giving button may go. A KEY, never a URL - see the file header. */
export const GIVING_DESTINATIONS: readonly { key: string; label: string }[] = [
  { key: 'one', label: 'One-time gift page' },
  { key: 'monthly', label: 'Monthly gift page' },
  { key: 'partners', label: 'Impact Partners page' }
];

/** Chosen from a list rather than typed: a mistyped Font Awesome class
 *  renders as an empty square with nothing to explain it. */
export const ICON_CHOICES: readonly { value: string; label: string }[] = [
  { value: 'fas fa-dollar-sign', label: 'Dollar sign' },
  { value: 'fas fa-calendar-days', label: 'Calendar' },
  { value: 'fa fa-envelope-open-text', label: 'Open envelope' },
  { value: 'fa-solid fa-hand-holding-medical', label: 'Helping hand' },
  { value: 'fas fa-heart', label: 'Heart' },
  { value: 'fas fa-church', label: 'Church' },
  { value: 'fas fa-users', label: 'People' },
  { value: 'fas fa-book-open', label: 'Open book' },
  { value: 'fas fa-hands-praying', label: 'Praying hands' }
];


// ------------------------------------------------------------- the pages

export const EDITABLE_PAGES: readonly EditablePage[] = [
  // EMPTY since 2026-08-31: all twelve original pages CUT OVER to the
  // section kit. Every page is a kit page now, edited through
  // kit-page.adapter's kinds; this list, pageFor() and kindFor() stay only
  // for the shells that still reference them, and retire with them.
];


export function pageFor(slug: string): EditablePage | undefined {
  return EDITABLE_PAGES.find((page) => page.slug === slug);
}

/**
 * Every list on these pages is counted in its OWN words - "3 courses",
 * "2 tiles", "7 passages" - because "3 items" tells staff nothing about which
 * row they are looking at. Enough of a rule to get `entry` right, which a
 * bare +s spells "entrys".
 */
export function pluralise(noun: string, n: number): string {
  if (n === 1) {
    return noun;
  }
  return /[^aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`;
}

export function kindFor(page: EditablePage | undefined, type: string | undefined)
  : PageSectionKind | undefined {
  return page?.kinds.find((kind) => kind.type === type);
}
