import { PAGE_SECTION_TYPES } from '@impact-common/shared/lists/page_section_types.enum';

/** Which editable fields a section type actually uses. */
export interface AboutSectionFields {
  heading?: boolean;
  subheading?: boolean;
  body?: boolean;
  image?: boolean;
  cta?: boolean;
  video?: boolean;
  /** Repeated entries - only the timeline. */
  entries?: boolean;
}

export interface AboutSectionKind {
  type: PAGE_SECTION_TYPES;
  label: string;
  blurb: string;
  icon: string;
  /** At most one of these may sit on the page. */
  singleton: boolean;
  fields: AboutSectionFields;
  /** Wording for each field, because they mean different things per type. */
  headingLabel?: string;
  subheadingLabel?: string;
  imageLabel?: string;
}

/**
 * Every section the About Us page can render, in the order the Add menu
 * offers them.
 *
 * ONE list drives the Add menu, each row's icon and label, and which fields
 * the editor shows - so adding a section type is an entry here plus a case
 * in the web app's AboutSectionComponent.
 *
 * These name SHAPES, not positions. A story is copy and a button beside a
 * picture wherever it sits; the page happens to open with three of them.
 * Which side the picture goes on is NOT a field: it alternates by the
 * block's position among story blocks, so dragging one somewhere new can
 * never leave two pictures stacked together.
 */
export const ABOUT_SECTION_KINDS: readonly AboutSectionKind[] = [
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
  {
    type: PAGE_SECTION_TYPES.MISSION,
    label: 'Copy with a video',
    blurb: 'a heading and copy on one side, a click-to-play video on the other',
    icon: 'play_circle',
    singleton: false,
    fields: { heading: true, body: true, image: true, video: true },
    imageLabel: 'Still shown before play'
  },
  {
    type: PAGE_SECTION_TYPES.TIMELINE,
    label: 'Timeline',
    blurb: 'dated entries down a centre line, alternating left and right',
    icon: 'timeline',
    // One per page: two timelines would each draw their own centre line.
    singleton: true,
    fields: { heading: true, subheading: true, entries: true },
    headingLabel: 'Year at the top',
    subheadingLabel: 'Year at the bottom'
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
];

export function aboutKindFor(type: string | undefined): AboutSectionKind | undefined {
  return ABOUT_SECTION_KINDS.find((kind) => kind.type === type);
}
