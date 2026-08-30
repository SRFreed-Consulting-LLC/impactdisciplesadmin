import { PageContentModel } from '@impact-common/shared/models/domain/page-content.model';
import { SECTION_ARCHETYPE, SECTION_KIT } from '@impact-common/shared/lists/section_kit';
import { isKitPage, kitPage } from './kit-page.adapter';
import { kindFor } from './page-section-catalogue';

/**
 * The kit, shaped as a catalogue page.
 *
 * This adapter is what lets a page staff created be edited by the SAME screen
 * the twelve original pages use. It is derived from SECTION_KIT by hand, so
 * nothing type-checks that it covers the kit or that its entry editors line
 * up with the variants that need one - which is what these assertions are.
 */

const page = (over: Partial<PageContentModel> = {}) =>
  ({ id: 'mens-retreat', title: "Men's Retreat", blocks: [], ...over }) as PageContentModel;

describe('a kit page as a catalogue page', () => {
  it('offers every archetype the kit declares', () => {
    const offered = new Set(kitPage(page()).kinds.map((k) => k.type));
    const missing = SECTION_KIT.map((d) => d.archetype).filter((a) => !offered.has(a));

    expect(missing)
      .withContext('these are in the kit but a staff page cannot add them')
      .toEqual([]);
  });

  it('offers no type twice, so kindFor() can never shadow one', () => {
    // kindFor() takes the first match. A duplicate makes the second
    // unreachable - including its variants and its entry editors.
    const types = kitPage(page()).kinds.map((k) => k.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('carries every variant of every archetype', () => {
    const built = kitPage(page());
    const problems: string[] = [];

    for (const def of SECTION_KIT) {
      const kind = kindFor(built, def.archetype);
      if (!kind) {
        problems.push(`${def.archetype}: no kind`);
        continue;
      }
      const keys = (kind.variants ?? []).map((v) => v.key);
      for (const variant of def.variants) {
        if (!keys.includes(variant.key)) {
          problems.push(`${def.archetype}/${variant.key}: not offered`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it('gives an entry editor to exactly the variants that are lists', () => {
    // THE ASSERTION THIS FILE EXISTS FOR. A variant with `entries` and no
    // entry spec opens a dialog with an Add button and no fields; one with an
    // entry spec and no `entries` shows a list nothing draws. Both are
    // silent, and both are only visible by opening the editor and trying.
    const mismatched: string[] = [];

    for (const kind of kitPage(page()).kinds) {
      for (const variant of kind.variants ?? []) {
        const isList = !!variant.fields.entries;
        const hasEditor = !!variant.entry;
        if (isList !== hasEditor) {
          mismatched.push(
            `${kind.type}/${variant.key}: entries=${isList} but entry spec=${hasEditor}`
          );
        }
      }
    }

    expect(mismatched).toEqual([]);
  });

  it('gives every list entry editor a noun of its own', () => {
    // "3 items" tells staff nothing about which row they are looking at.
    // "3 tiles", "7 passages" does.
    const nameless: string[] = [];
    for (const kind of kitPage(page()).kinds) {
      for (const variant of kind.variants ?? []) {
        if (variant.entry && !variant.entry.noun?.trim()) {
          nameless.push(`${kind.type}/${variant.key}`);
        }
      }
    }

    expect(nameless).toEqual([]);
  });

  it('lets every section choose its ground', () => {
    // The colour axis. A kind with no surfaces would leave its sections stuck
    // on the page's theme with no way to break the run - which About Us's
    // dark band between light columns is the standing argument against.
    const stuck = kitPage(page()).kinds
      .filter((k) => !k.surfaces?.length)
      .map((k) => k.type);

    expect(stuck).toEqual([]);
  });

  it('defaults a kind to its first variant, so it opens on real fields', () => {
    const hero = kindFor(kitPage(page()), SECTION_ARCHETYPE.HERO_BAND);
    expect(hero?.fields).toEqual(hero?.variants?.[0]?.fields as never);
  });

  it('takes its label from the page title and its slug from the document id', () => {
    // A builder page has no nav leaf to take a label from, so the title is
    // it. The slug is the document id AND the public route.
    const built = kitPage(page({ id: 'summit-recap', title: 'Summit Recap' }));

    expect(built.slug).toBe('summit-recap');
    expect(built.label).toBe('Summit Recap');
    expect(built.path).toBe('/summit-recap');
  });

  it('falls back to the slug when a page somehow has no title', () => {
    // Should not happen - a page with no title is not a kit page at all - but
    // a blank heading above the editor is worse than a slug.
    expect(kitPage(page({ title: undefined })).label).toBe('mens-retreat');
  });
});

describe('telling a staff page from one of the twelve', () => {
  it('counts a document with a title as one staff created', () => {
    expect(isKitPage({ title: "Men's Retreat" })).toBeTrue();
  });

  it('counts a document with no title as one of the originals', () => {
    // The twelve carry no title - they take their label from a nav leaf. This
    // is the ONLY thing distinguishing the two, deliberately: see
    // PageContentModel on why a flag would be worse.
    expect(isKitPage({ title: undefined })).toBeFalse();
    expect(isKitPage({ title: '' })).toBeFalse();
    expect(isKitPage(null)).toBeFalse();
  });
});
