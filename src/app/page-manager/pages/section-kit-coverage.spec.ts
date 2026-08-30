import { EDITABLE_PAGES } from './page-section-catalogue';
import { LEGACY_RENDERINGS } from '@impact-common/shared/lists/section_kit';

/**
 * THE KIT AGAINST THE REAL CATALOGUE.
 *
 * `LEGACY_RENDERINGS` claims to name a home in the section kit for every
 * section the site offers. It was hand-written from a read of the nine web
 * section components, so nothing type-checks that claim - and the shared
 * submodule cannot check it either, because `EDITABLE_PAGES` lives here.
 *
 * This is the only place the two lists meet. It fails if the kit forgets a
 * section, or claims one the catalogue does not offer.
 *
 * WHAT THIS DOES NOT PROVE: that a section still LOOKS right once it is drawn
 * by the kit rather than by its page's own component. Only a rendered
 * comparison shows that, and it belongs in the web repo beside the renderers.
 * A green run here is not permission to delete a bespoke component.
 */
describe('section kit coverage of the catalogue', () => {
  const catalogueKeys = EDITABLE_PAGES
    .flatMap((page) => page.kinds.map((kind) => `${page.slug}/${kind.type}`))
    .sort();

  const kitKeys = LEGACY_RENDERINGS
    .map((rendering) => `${rendering.page}/${rendering.type}`)
    .sort();

  it('names a home for every section the catalogue offers', () => {
    // A miss here is a section staff can add and the kit cannot draw - which
    // after a migration is a band that vanishes from a live page.
    const inKit = new Set(kitKeys);
    const missing = catalogueKeys.filter((key) => !inKit.has(key));

    expect(missing).toEqual([]);
  });

  it('claims no section the catalogue does not offer', () => {
    // The other direction, and the one that rots quietly: a row left behind
    // after a page or a kind is removed. It would migrate nothing and go on
    // being counted as covered.
    const inCatalogue = new Set(catalogueKeys);
    const stale = kitKeys.filter((key) => !inCatalogue.has(key));

    expect(stale).toEqual([]);
  });

  it('maps exactly one row per declared kind', () => {
    // Not just the same set - the same COUNT, so a duplicated row cannot
    // hide a missing one.
    expect(kitKeys.length).toBe(catalogueKeys.length);
    expect(new Set(kitKeys).size).toBe(kitKeys.length);
  });
});
