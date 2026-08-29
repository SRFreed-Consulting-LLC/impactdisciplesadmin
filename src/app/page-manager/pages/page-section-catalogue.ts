import { PAGE_SECTION_TYPES } from '@impact-common/shared/lists/page_section_types.enum';

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

export interface PageSectionKind {
  type: PAGE_SECTION_TYPES;
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

// ------------------------------------------------------- kind builders
//
// Most pages want the same section with different words around it, so each
// builder carries the sensible default and takes an override. The point is
// that a page's `kinds` below reads as a list of what that page IS.

const pageHeader = (over: Partial<PageSectionKind> = {}): PageSectionKind => ({
  type: PAGE_SECTION_TYPES.PAGE_HEADER,
  label: 'Page header',
  blurb: 'the band at the top: a photo, a small line above, the big title, and buttons',
  icon: 'wallpaper',
  // One per page: a second header would put two titles above the fold.
  singleton: true,
  fields: { heading: true, subheading: true, body: true, image: true, cta: true, cta2: true },
  headingLabel: 'Title',
  subheadingLabel: 'Small line above the title',
  bodyLabel: 'Line under the title',
  imageLabel: 'Background photo',
  ...over
});

const prose = (over: Partial<PageSectionKind> = {}): PageSectionKind => ({
  type: PAGE_SECTION_TYPES.PROSE,
  label: 'Heading and copy',
  blurb: 'a heading with a passage under it, across the page',
  icon: 'subject',
  singleton: false,
  fields: { heading: true, body: true },
  ...over
});

const mission = (over: Partial<PageSectionKind> = {}): PageSectionKind => ({
  type: PAGE_SECTION_TYPES.MISSION,
  label: 'Copy with a video',
  blurb: 'a heading and copy on one side, a click-to-play video on the other',
  icon: 'play_circle',
  singleton: false,
  fields: { heading: true, body: true, image: true, video: true },
  imageLabel: 'Still shown before play',
  ...over
});

const consultBanner = (): PageSectionKind => ({
  type: PAGE_SECTION_TYPES.CONSULT_BANNER,
  label: 'Consultation banner',
  blurb: 'the shared "receive a free consultation" band',
  icon: 'campaign',
  singleton: true,
  fields: {},
  caveat:
    'Nothing on this band is edited here - it is the same one every page ' +
    'shows. It is a section so you can move it or switch it off.'
});

// ------------------------------------------------------------- the pages

export const EDITABLE_PAGES: readonly EditablePage[] = [
  {
    slug: 'about-us',
    label: 'About Us',
    path: '/about-us',
    blurb: 'The story columns, the history band, the mission, the timeline and the countries figure.',
    kinds: [
      {
        type: PAGE_SECTION_TYPES.STORY,
        label: 'Story column',
        blurb: 'copy and a button beside a picture; the side alternates automatically',
        icon: 'view_sidebar',
        singleton: false,
        fields: { heading: true, body: true, image: true, cta: true },
        imageLabel: 'Picture beside the copy'
      },
      {
        type: PAGE_SECTION_TYPES.BANNER,
        label: 'Full-width banner',
        blurb: 'a background photo with one heading across it',
        icon: 'panorama',
        singleton: false,
        fields: { heading: true, image: true },
        imageLabel: 'Background photo'
      },
      mission(),
      {
        type: PAGE_SECTION_TYPES.TIMELINE,
        label: 'Timeline',
        blurb: 'dated entries down a centre line, alternating left and right',
        icon: 'timeline',
        // One per page: two timelines would each draw their own centre line.
        singleton: true,
        fields: { heading: true, subheading: true, entries: true },
        headingLabel: 'Year at the top',
        subheadingLabel: 'Year at the bottom',
        entry: {
          noun: 'entry',
          note:
            'Entries alternate left and right down the centre line, by position — ' +
            'so dragging one somewhere new never leaves two photos on the same side. ' +
            'A year is optional: it draws a big marker above that entry.',
          sideLabels: ['copy left', 'copy right'],
          fields: { image: true, title: true, description: true },
          titleLabel: 'Year',
          descriptionLabel: 'Copy',
          imageLabel: 'Photo'
        }
      },
      {
        type: PAGE_SECTION_TYPES.COUNTRIES,
        label: 'Figure banner',
        blurb: 'a big number with a label, and a paragraph beside it',
        icon: 'public',
        singleton: false,
        fields: { heading: true, subheading: true, body: true, image: true },
        headingLabel: 'The number',
        subheadingLabel: 'Label under the number',
        imageLabel: 'Background photo'
      }
    ]
  },

  {
    slug: 'equipping-groups',
    label: 'Equipping Groups',
    path: '/equipping-groups',
    blurb: 'The hub page: the overview beside its video, and the three course cards.',
    kinds: [
      pageHeader(),
      mission({ label: 'Overview with a video' }),
      {
        type: PAGE_SECTION_TYPES.CARDS,
        label: 'Course list',
        blurb: 'a heading over one row per course: a button and a line saying what it is',
        icon: 'view_list',
        singleton: false,
        fields: { heading: true, entries: true },
        entry: {
          noun: 'course',
          fields: { title: true, description: true, link: true },
          titleLabel: 'Button text',
          descriptionLabel: 'What it is',
          linkLabel: 'Goes to'
        }
      },
      consultBanner()
    ]
  },

  ...['pastors', 'leaders', 'churches'].map((audience) => equippingCoursePage(audience)),

  {
    slug: 'seminars',
    label: 'Seminars',
    path: '/seminars',
    blurb: 'The overview, the two prices, what you get, the four-part plan and the consultation form.',
    kinds: [
      pageHeader(),
      prose({ label: 'Overview' }),
      {
        type: PAGE_SECTION_TYPES.PRICES,
        label: 'Price tiles',
        blurb: 'one tile per option: a title, a price, what is included, and a button',
        icon: 'sell',
        singleton: false,
        fields: { entries: true },
        caveat:
          'The AMOUNTS come from Web Config, not from here. Each tile names ' +
          'the figure it wants, so a price is only ever stored in one place.',
        entry: {
          noun: 'tile',
          fields: { title: true, amount: true, body: true, cta: true },
          titleLabel: 'Tile title',
          bodyLabel: 'What is included'
        }
      },
      mission({ label: 'What you get, with a video' }),
      {
        type: PAGE_SECTION_TYPES.CARDS,
        label: 'Picture cards',
        blurb: 'a heading over cards, each a picture with a title and a line of copy',
        icon: 'grid_view',
        singleton: false,
        fields: { heading: true, entries: true },
        entry: {
          noun: 'card',
          fields: { image: true, title: true, description: true },
          titleLabel: 'Card title',
          descriptionLabel: 'Copy',
          imageLabel: 'Picture'
        }
      },
      {
        type: PAGE_SECTION_TYPES.FORM,
        label: 'Copy with a form',
        blurb: 'a heading and a passage beside one of the forms from Form Builder',
        icon: 'assignment',
        singleton: false,
        fields: { heading: true, body: true, image: true, cta: true },
        imageLabel: 'Background photo',
        ctaLabel: 'Submit button text',
        caveat:
          'WHICH form this shows stays in the site - it is a Firestore id, ' +
          'and one retyped by hand is a blank widget nobody can diagnose. ' +
          'Edit the form itself in Tools > Form Builder.'
      }
    ]
  },

  {
    slug: 'lunch-and-learns',
    label: 'Lunch and Learns',
    path: '/lunch-and-learns',
    blurb: 'The overview, and what you get beside the video.',
    kinds: [
      pageHeader(),
      prose({ label: 'Overview' }),
      mission({ label: 'What you get, with a video' })
    ]
  },

  {
    slug: 'give',
    label: 'Give',
    path: '/give',
    blurb: 'The three giving options, the line under them, and the cheque band.',
    kinds: [
      pageHeader({ fields: { heading: true, subheading: true, body: true, image: true } }),
      {
        type: PAGE_SECTION_TYPES.GIVE_OPTIONS,
        label: 'Giving options',
        blurb: 'one tile per way to give: a title, an icon, copy and a button',
        icon: 'volunteer_activism',
        singleton: true,
        fields: { entries: true },
        caveat:
          'WHERE EACH BUTTON GOES is chosen from the ministry\'s three payment ' +
          'pages and cannot be typed. A free-text address here would let ' +
          'anyone who can edit this page redirect donations.',
        entry: {
          noun: 'option',
          fields: { title: true, icon: true, body: true, cta: true, giving: true },
          titleLabel: 'Option title'
        }
      },
      prose({
        label: 'A line across the page',
        blurb: 'one passage, centred, between the options and the band',
        fields: { body: true }
      }),
      {
        type: PAGE_SECTION_TYPES.ADDRESS_BAND,
        label: 'Cheque band',
        blurb: 'a photo band with where to post a cheque',
        icon: 'markunread_mailbox',
        singleton: true,
        fields: { heading: true, subheading: true, image: true },
        headingLabel: 'Line above',
        subheadingLabel: 'Who to make it out to',
        imageLabel: 'Background photo',
        caveat:
          'The ADDRESS itself comes from the site details, so it is right in ' +
          'the footer and here at the same time. Change it in Web Config.'
      }
    ]
  },

  {
    slug: 'contact',
    label: 'Contact',
    path: '/contact',
    blurb: 'The two halves: the details on one side, the form on the other.',
    // The one page whose stack is a ROW. Order is left to right.
    horizontal: true,
    kinds: [
      {
        type: PAGE_SECTION_TYPES.CONTACT_INFO,
        label: 'Where to find us',
        blurb: 'a heading, the address block, a passage, and the social links',
        icon: 'contact_page',
        singleton: true,
        fields: { heading: true, body: true },
        caveat:
          'The address, phone, email and social links come from the site ' +
          'details - they already feed the footer. Change them in Web Config.'
      },
      {
        type: PAGE_SECTION_TYPES.FORM,
        label: 'Contact form',
        blurb: 'a heading over one of the forms from Form Builder',
        icon: 'assignment',
        singleton: true,
        fields: { heading: true, cta: true },
        ctaLabel: 'Submit button text',
        caveat:
          'WHICH form this shows stays in the site. Edit the form itself in ' +
          'Tools > Form Builder.'
      }
    ]
  },

  {
    slug: 'discipleship-library',
    label: 'Discipleship Library',
    path: '/discipleship-library',
    blurb: 'The reader app\'s landing page: its hero, the seven feature rows, and the closing block.',
    kinds: [
      pageHeader({
        label: 'Hero',
        blurb: 'the dark band at the top: an eyebrow, the title, a lede, the button and a screenshot',
        fields: { heading: true, subheading: true, body: true, note: true, image: true, cta: true },
        subheadingLabel: 'Eyebrow above the title',
        bodyLabel: 'Lede',
        noteLabel: 'Small line under the button',
        imageLabel: 'Screenshot beside the copy',
        caveat: 'The button opens the Library app. Where it goes stays in the site.'
      }),
      {
        type: PAGE_SECTION_TYPES.FEATURES,
        label: 'Feature rows',
        blurb: 'the jump strip and one row per area of the app, alternating side to side',
        icon: 'view_agenda',
        singleton: true,
        fields: { entries: true },
        entry: {
          noun: 'row',
          note:
            'The strip at the top of this section is built from the same list, ' +
            'so it can never fall out of step. The "01/02" numbers are counted ' +
            'from the order, and rows alternate which side their picture sits ' +
            'on by position — neither is stored, so dragging a row is safe. ' +
            'Upload an .mp4 instead of a picture and the row plays it muted on ' +
            'a loop.',
          sideLabels: ['picture left', 'picture right'],
          numbered: true,
          fields: { image: true, title: true, heading: true, description: true, body: true },
          titleLabel: 'Name in the strip',
          headingLabel: 'Headline',
          descriptionLabel: 'Copy',
          bodyLabel: 'Bullets',
          imageLabel: 'Screenshot or clip'
        }
      },
      prose({
        label: 'Closing block',
        blurb: 'the blue band at the foot: a heading, a line, and the way in',
        fields: { heading: true, body: true, cta: true },
        caveat: 'The button opens the Library app. Where it goes stays in the site.'
      })
    ]
  },

  {
    slug: 'prayer-team',
    label: 'Prayer Team',
    path: '/prayer-team',
    blurb: 'The hero and its buttons, and the copy above the join form.',
    kinds: [
      pageHeader({
        blurb: 'the band at the top: a photo, a small line above, the title, and any number of buttons',
        fields: { heading: true, subheading: true, image: true, entries: true },
        entry: {
          noun: 'button',
          fields: { title: true, link: true, icon: true },
          titleLabel: 'Button text',
          linkLabel: 'Goes to'
        }
      }),
      {
        type: PAGE_SECTION_TYPES.SIGNUP,
        label: 'Join form',
        blurb: 'the copy above the sign-up form, and the button on it',
        icon: 'how_to_reg',
        singleton: true,
        fields: { body: true, cta: true },
        ctaLabel: 'Button on the form',
        caveat:
          'WHICH DETAILS the form asks for stays in the site - that is a ' +
          'decision about a mailing list rather than page copy.'
      }
    ]
  }
];

/**
 * The three course pages, which are the same page three times over.
 *
 * They differ only in audience and in the document each one reads, and their
 * web templates were folded into one on 2026-08-29 for the same reason.
 * Writing this out three times would be three chances to fix a label in two
 * places.
 */
function equippingCoursePage(audience: string): EditablePage {
  const label = audience[0].toUpperCase() + audience.slice(1);
  return {
    slug: `equipping-groups-${audience}`,
    label: `Equipping - ${label}`,
    path: `/equipping-groups-${audience}`,
    blurb: `The ${label} course page: the overview beside its video, then the two columns.`,
    kinds: [
      pageHeader(),
      mission({ label: 'Overview with a video' }),
      {
        type: PAGE_SECTION_TYPES.COLUMNS,
        label: 'Two columns',
        blurb: 'headed passages in two columns - the facts on the left, the pitch on the right',
        icon: 'view_column',
        singleton: true,
        fields: { entries: true },
        entry: {
          noun: 'passage',
          note:
            'Which column a passage sits in is YOURS to set, unlike everywhere ' +
            'else on these pages - the two columns say different kinds of ' +
            'thing rather than alternating. Order within a column is the order ' +
            'here. A passage can be a heading over copy, a price line, a ' +
            'button, or any combination.',
          fields: {
            title: true, body: true, column: true, amount: true, description: true, cta: true
          },
          titleLabel: 'Heading',
          bodyLabel: 'Copy',
          descriptionLabel: 'Note under the price'
        }
      },
      consultBanner()
    ]
  };
}

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
