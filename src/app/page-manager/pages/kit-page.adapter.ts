import { PageContentModel } from '@impact-common/shared/models/domain/page-content.model';
import {
  ArchetypeDef,
  SECTION_ARCHETYPE,
  SECTION_KIT,
  SectionVariant
} from '@impact-common/shared/lists/section_kit';
import { EditablePage, EntrySpec, KindVariant, PageSectionKind } from './page-section-catalogue';

/**
 * THE SECTION KIT, SHAPED AS A CATALOGUE PAGE.
 *
 * A page staff created has no entry in EDITABLE_PAGES - that list is code,
 * one hand-written entry per public page, and the whole point of the builder
 * is that a new page needs no code. But the section editor, the stack screen,
 * the entry control, the drag-and-drop and the auto-save are all already
 * built, and every one of them takes an `EditablePage`.
 *
 * So this makes one. It is an adapter and nothing else: the kit stays free of
 * admin concerns, the editor stays unaware there are two kinds of page, and
 * the ~900 lines of editing UI are reused rather than rewritten. A second
 * editor for builder pages would be the same screen with its own bugs.
 *
 * ONE KIND PER ARCHETYPE, NOT PER VARIANT. `kindFor()` matches on `type` and
 * takes the first hit, so two kinds sharing a type would make the second
 * unreachable - and the catalogue's own spec fails a page that offers a type
 * twice. Variants therefore hang off the kind, and the editor picks between
 * them.
 *
 * ENTRY SPECS LIVE HERE, not in the kit. `EntrySpec` describes an admin
 * CONTROL - its nouns, its labels, which columns to show - and the shared
 * submodule has no business knowing about the editor. The kit says a variant
 * is a list; this says what editing one looks like.
 */

/** What one entry is, per list variant. Keyed `archetype/variant`. */
const ENTRY_SPECS: Record<string, EntrySpec> = {
  'heroBand/buttonList': {
    noun: 'button',
    note: 'Buttons are entries rather than two fixed slots, so you can add a third, '
      + 'reorder them, or give one an icon.',
    fields: { title: true, link: true, icon: true },
    titleLabel: 'Button text',
    linkLabel: 'Goes to'
  },
  'copyMedia/buttonList': {
    noun: 'button',
    note: 'Buttons are entries rather than fixed slots, so you can add a third, '
      + 'reorder them, or give one an icon.',
    fields: { title: true, link: true, icon: true },
    titleLabel: 'Button text',
    linkLabel: 'Goes to'
  },
  'slider/slides': {
    noun: 'slide',
    note: 'Each slide is a full-width picture with words over it. The order here '
      + 'is the order they rotate in.',
    fields: { image: true, title: true, description: true, cta: true, link: true },
    imageLabel: 'Background picture',
    titleLabel: 'Heading',
    descriptionLabel: 'Line under the heading',
    linkLabel: 'Button goes to'
  },
  'listRows/buttonAndText': {
    noun: 'row',
    fields: { title: true, description: true, link: true },
    titleLabel: 'Button text',
    descriptionLabel: 'What it is',
    linkLabel: 'Goes to'
  },
  'listGrid/picture': {
    noun: 'tile',
    fields: { image: true, title: true, description: true },
    titleLabel: 'Tile title',
    descriptionLabel: 'Copy',
    imageLabel: 'Picture'
  },
  'listGrid/pictureRows': {
    noun: 'card',
    note: 'Each card is a square picture beside its title and copy - the '
      + 'Seminars picture cards\' own arrangement.',
    fields: { image: true, title: true, description: true },
    titleLabel: 'Card title',
    descriptionLabel: 'Copy',
    imageLabel: 'Picture (square)'
  },
  'listGrid/icon': {
    noun: 'tile',
    fields: { title: true, icon: true, body: true, cta: true },
    titleLabel: 'Tile title'
  },
  'listGrid/price': {
    noun: 'tile',
    // The figure is NAMED, never typed - a price with two homes drifts, and
    // this page is not its home.
    fields: { title: true, amount: true, body: true, cta: true },
    titleLabel: 'Tile title',
    bodyLabel: 'What is included'
  },
  'listArticles/plain': {
    noun: 'row',
    note: 'Which side the picture sits on alternates by position, so reordering '
      + 'can never stack two the same way.',
    sideLabels: ['picture left', 'picture right'],
    fields: { image: true, title: true, body: true, cta: true },
    titleLabel: 'Heading',
    bodyLabel: 'Copy',
    imageLabel: 'Picture'
  },
  'listArticles/numbered': {
    noun: 'row',
    note: 'The strip of names at the top is built from this same list, so it cannot '
      + 'fall out of step. The numbers are counted from the order and the picture '
      + 'side alternates by position - neither is stored, so dragging a row is safe.',
    sideLabels: ['picture left', 'picture right'],
    numbered: true,
    fields: { image: true, title: true, heading: true, description: true, body: true },
    titleLabel: 'Name in the strip',
    headingLabel: 'Headline',
    descriptionLabel: 'Copy',
    bodyLabel: 'Bullets',
    imageLabel: 'Picture or clip'
  },
  'listColumns/twoColumn': {
    noun: 'passage',
    note: 'Which column a passage sits in is YOURS to set, unlike everywhere else - '
      + 'the two columns say different kinds of thing rather than alternating.',
    fields: { title: true, body: true, column: true, amount: true, description: true, cta: true },
    titleLabel: 'Heading',
    bodyLabel: 'Copy',
    descriptionLabel: 'Note under the price'
  },
  'timeline/centreLine': {
    noun: 'entry',
    note: 'Entries alternate left and right down the centre line, by position. '
      + 'A year is optional: it draws a big marker above that entry.',
    sideLabels: ['copy left', 'copy right'],
    fields: { image: true, title: true, description: true },
    titleLabel: 'Year',
    descriptionLabel: 'Copy',
    imageLabel: 'Picture'
  }
};

/** Caveats worth saying before somebody edits one of these. Same wording as
 *  the equivalent sections on the twelve original pages, because they are the
 *  same rules. */
const CAVEATS: Partial<Record<SECTION_ARCHETYPE, string>> = {
  [SECTION_ARCHETYPE.CAROUSEL]:
    'Only the ORDER is set here. A quote\'s words, who said it and whether it '
    + 'appears at all belong to the Testimonials screen, because the same quote '
    + 'can be shown on more than one page.',
  [SECTION_ARCHETYPE.CONTACT_DETAILS]:
    'The address, phone, email and social links come from the site details - '
    + 'they already feed the footer. Change them in Web Config.',
  [SECTION_ARCHETYPE.FIXED_BAND]:
    'Nothing on this band is edited here - it is the same one every page shows. '
    + 'It is a section so you can move it or switch it off.',
  [SECTION_ARCHETYPE.FORM]:
    'WHICH form this shows is not set here. It is a Firestore id, and one '
    + 'retyped by hand is a blank widget nobody can diagnose.'
};

function toVariant(archetype: SECTION_ARCHETYPE, variant: SectionVariant): KindVariant {
  return {
    key: variant.key,
    label: variant.label,
    blurb: variant.blurb,
    // KitFields and PageSectionFields are the same shape by construction -
    // both are "which of a block's own fields this uses". Kept as two types
    // rather than one because the kit is shared and the catalogue is not.
    fields: { ...variant.fields },
    entry: ENTRY_SPECS[`${archetype}/${variant.key}`]
  };
}

function toKind(def: ArchetypeDef): PageSectionKind {
  const variants = def.variants.map((variant) => toVariant(def.archetype, variant));
  const first = variants[0];

  return {
    type: def.archetype,
    label: def.label,
    blurb: def.blurb,
    icon: def.icon,
    singleton: !!def.singleton,
    // The first variant's, so a kind opened before anything is chosen shows
    // the right fields rather than none.
    fields: first.fields,
    entry: first.entry,
    variants,
    // Every kit section may be re-grounded. This is the list the editor's
    // Surface control offers.
    surfaces: ['inherit', 'light', 'dark', 'tinted', 'photo'],
    caveat: CAVEATS[def.archetype]
  };
}

/** The kit's kinds, built once - they are constant. */
const KIT_KINDS: PageSectionKind[] = SECTION_KIT.map(toKind);

/**
 * An EditablePage for a page staff created, so every existing editing screen
 * works on it unchanged.
 *
 * `slug` is the document id and the public route; `label` is the page's own
 * title, because a builder page has no nav leaf to take a label from.
 */
export function kitPage(page: PageContentModel): EditablePage {
  const slug = page.id ?? '';
  return {
    slug,
    label: page.title || slug,
    path: `/${slug}`,
    blurb: 'A page you created. Add sections, drag them into order, and switch any of them off.',
    kinds: KIT_KINDS
  };
}

/** Whether a document is a page staff created rather than one of the twelve
 *  originals. A `title` is the only thing that distinguishes them - see
 *  PageContentModel, where that is a deliberate choice over a flag. */
export function isKitPage(page: Pick<PageContentModel, 'title'> | null | undefined): boolean {
  return !!page?.title;
}
