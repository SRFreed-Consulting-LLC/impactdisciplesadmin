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
  'list/slides': {
    noun: 'slide',
    note: 'Each slide is a full-width picture with words over it. The order here '
      + 'is the order they rotate in.',
    fields: { image: true, title: true, description: true, cta: true, link: true },
    imageLabel: 'Background picture',
    titleLabel: 'Heading',
    descriptionLabel: 'Line under the heading',
    linkLabel: 'Button goes to'
  },
  'list/rows': {
    noun: 'row',
    fields: { title: true, description: true, link: true },
    titleLabel: 'Button text',
    descriptionLabel: 'What it is',
    linkLabel: 'Goes to'
  },
  'list/tiles': {
    noun: 'tile',
    fields: { image: true, title: true, description: true },
    titleLabel: 'Tile title',
    descriptionLabel: 'Copy',
    imageLabel: 'Picture'
  },
  'list/pictureRows': {
    noun: 'card',
    note: 'Each card is a square picture beside its title and copy - the '
      + 'Seminars picture cards\' own arrangement.',
    fields: { image: true, title: true, description: true },
    titleLabel: 'Card title',
    descriptionLabel: 'Copy',
    imageLabel: 'Picture (square)'
  },
  'list/quoteCards': {
    noun: 'quote',
    // The card puts the QUOTE first and the name under it, but this editor
    // draws entry fields in one fixed order for every variant - title in the
    // top row, the long fields below it. So the name sits above the quote
    // HERE while the card reads the other way round, and the note says so
    // rather than leaving staff to discover it from the preview. Swapping the
    // two fields would line them up, but a quote needs the multi-line control
    // and the title row is a single-line input.
    note: 'The quote is the first thing on the card. Who said it reads as a '
      + 'footnote underneath it, the way an attribution does - so a card can '
      + 'be read as a quote first and a name second.',
    fields: { image: true, title: true, description: true, body: true },
    imageLabel: 'Photo (square)',
    titleLabel: 'Who said it',
    descriptionLabel: 'The quote',
    bodyLabel: 'Their role or church (optional)'
  },
  'list/icon': {
    noun: 'tile',
    fields: { title: true, icon: true, body: true, cta: true },
    titleLabel: 'Tile title'
  },
  'list/price': {
    noun: 'tile',
    // The figure is NAMED, never typed - a price with two homes drifts, and
    // this page is not its home.
    fields: { title: true, amount: true, body: true, cta: true },
    titleLabel: 'Tile title',
    bodyLabel: 'What is included'
  },
  'list/articles': {
    noun: 'row',
    note: 'Which side the picture sits on alternates by position, so reordering '
      + 'can never stack two the same way.',
    sideLabels: ['picture left', 'picture right'],
    fields: { image: true, title: true, body: true, cta: true },
    titleLabel: 'Heading',
    bodyLabel: 'Copy',
    imageLabel: 'Picture'
  },
  'list/numbered': {
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
  'list/timeline': {
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

// LIST_LOOK_SPECS lived here until 2026-09-01: a map from each List look to
// the archetype whose entry spec it borrowed. The specs above are keyed on
// the looks themselves now, so there is nothing left to translate.

// CAVEATS lived here until 2026-09-01, keyed on three archetypes. Each one
// found a better home than a map: the form and site-details warnings are on
// their PIECES, where somebody meets them while adding one, and the quote
// carousel says its own in the look's blurb. A caveat beside the thing it
// warns about beats a lookup table of them.


// BUTTON_BEARING listed the five archetypes whose entries were BUTTONS
// rather than content. All five were compositions absorbed by SECTION on
// 2026-09-01, where buttons are a piece of their own carrying a list - so
// there is no longer a section whose  mean buttons.

function toVariant(archetype: SECTION_ARCHETYPE, variant: SectionVariant): KindVariant {
  const named = ENTRY_SPECS[`${archetype}/${variant.key}`];
  return {
    key: variant.key,
    label: variant.label,
    blurb: variant.blurb,
    // KitFields and PageSectionFields are the same shape by construction -
    // both are "which of a block's own fields this uses". Kept as two types
    // rather than one because the kit is shared and the catalogue is not.
    fields: { ...variant.fields },
    entry: named
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
/**
 * WHERE A KIT PAGE LIVES on the public site.
 *
 * Every page is served at its own slug except HOME, which is the site root -
 * the one page whose address is not its name. The dynamic route deliberately
 * refuses `/home` so it cannot become a second copy of the front page, which
 * means anything pointing an editor or a preview at `/home` gets Not Found.
 * That is exactly what the Home screen's preview showed until 2026-08-31.
 */
export function publicPathFor(slug: string): string {
  return slug === 'home' ? '/' : `/${slug}`;
}

export function kitPage(page: PageContentModel): EditablePage {
  const slug = page.id ?? '';
  return {
    slug,
    label: page.title || slug,
    path: publicPathFor(slug),
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
