import { HOME_SECTION_TYPES } from '@impact-common/shared/lists/home_section_types.enum';

/** Which editable fields a section type actually uses. */
export interface HomeSectionFields {
  title?: boolean;
  subtitle?: boolean;
  image?: boolean;
  cta?: boolean;
  video?: boolean;
  items?: boolean;
  /**
   * Edited as the slider's own SLIDES rather than as fields - the slides are
   * a separate collection, so this opens the slides dialog instead of the
   * section editor. Only the slider sets it.
   */
  slides?: boolean;
}

export interface HomeSectionKind {
  type: HOME_SECTION_TYPES;
  /** What staff call it. */
  label: string;
  /** One line under the label, saying what a visitor sees. */
  blurb: string;
  icon: string;
  /**
   * True when only ONE of this type may sit on the page. Two sliders would
   * draw the same slides twice and there is one summit; a second banner or
   * services strip is a reasonable thing to want.
   *
   * Advisory, exactly like the model says: this hides the type in the Add
   * menu once it is placed. Nothing in the data enforces it.
   */
  singleton: boolean;
  fields: HomeSectionFields;
  /** Wording for the image field, which means something different per type. */
  imageLabel?: string;
}

/**
 * Every section type the home page can render, in the order the Add menu
 * offers them.
 *
 * ONE list drives the Add menu, each row's icon and label, and which fields
 * the editor shows - so adding a type is a single entry here plus a case in
 * the web app's HomeSectionComponent.
 */
export const HOME_SECTION_KINDS: readonly HomeSectionKind[] = [
  {
    type: HOME_SECTION_TYPES.SLIDER,
    label: 'Home Slider',
    blurb: 'the rotating hero at the top - the first thing a visitor sees',
    icon: 'view_carousel',
    singleton: true,
    // Its slides are their own collection, so the pencil opens the slides
    // dialog rather than the section editor.
    fields: { slides: true }
  },
  {
    type: HOME_SECTION_TYPES.SERVICES,
    label: 'Services strip',
    blurb: 'a row of cards, each with a picture, a heading and a link',
    icon: 'grid_view',
    singleton: false,
    fields: { items: true }
  },
  {
    type: HOME_SECTION_TYPES.SUMMIT_BANNER,
    label: 'Summit banner',
    blurb: 'the Disciple-Making Summit countdown and register button',
    icon: 'timer',
    singleton: true,
    // No subtitle: the countdown fills that space.
    fields: { title: true, image: true, cta: true },
    imageLabel: 'Background picture'
  },
  {
    type: HOME_SECTION_TYPES.VIDEO,
    label: 'Video',
    blurb: 'a heading, a line of copy and a click-to-play video',
    icon: 'play_circle',
    singleton: false,
    fields: { title: true, subtitle: true, image: true, video: true },
    imageLabel: 'Still shown before play'
  },
  {
    type: HOME_SECTION_TYPES.BANNER,
    label: 'Banner',
    blurb: 'a picture on one side, copy and a button on the other',
    icon: 'view_sidebar',
    singleton: false,
    fields: { title: true, subtitle: true, image: true, cta: true },
    imageLabel: 'Picture'
  },
  {
    type: HOME_SECTION_TYPES.SUBSCRIBE,
    label: 'Subscribe area',
    blurb: 'the mailing-list signup block',
    icon: 'mark_email_read',
    singleton: true,
    // The form itself is not editable - it is a Cloud Function's contract.
    fields: { title: true, subtitle: true, image: true },
    imageLabel: 'Background picture'
  }
];

/**
 * TESTIMONIALS is deliberately absent. It exists in HOME_SECTION_TYPES so
 * the section can be added later without a submodule change, but the web
 * app has no renderer for it yet - offering it here would let staff add a
 * section that draws nothing. Add an entry when the renderer lands.
 */

export function kindFor(type: HOME_SECTION_TYPES | string): HomeSectionKind | undefined {
  return HOME_SECTION_KINDS.find((kind) => kind.type === type);
}
