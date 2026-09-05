import { PageContentBlock } from '@impact-common/shared/models/domain/page-content.model';
import { SECTION_ARCHETYPE } from '@impact-common/shared/lists/section_kit';
import { PageSectionAppearanceComponent } from './page-section-appearance.component';

/**
 * THE APPEARANCE PANEL.
 *
 * Split out of the section editor on 2026-09-05. Hand-constructed rather than
 * TestBed: the panel takes section and kind as plain inputs, injects nothing
 * and owns no state, which is exactly the case CLAUDE.md's house style says
 * to build directly.
 *
 * These specs came WITH the extraction rather than being written for it -
 * they were passing against the editor the day before, and the point of
 * moving them unchanged is that they still pass against the panel. A refactor
 * whose tests had to be rewritten to keep passing has not been shown to
 * preserve behaviour.
 */
/**
 * THE BOX BEHIND A CARD.
 *
 * The controls for `cardGround`/`cardInk` were removed at some point and the
 * unused member declarations left behind, while the renderer went on drawing
 * them - so the Give page carried `cardGround: 'dark'` for weeks, showing
 * black boxes nobody could see or change from the admin.
 *
 * The defaults are the part worth pinning. groundClasses() in the web app
 * applies its OWN default when no ink is stored; if the editor shows a
 * different one, the control lies about what the page renders.
 */
describe('the box behind a card', () => {
  function build(section: Partial<PageContentBlock> = {}): PageSectionAppearanceComponent {
    const component = new PageSectionAppearanceComponent();
    component.section = {
      key: 'k', type: SECTION_ARCHETYPE.LIST, variant: 'tiles', items: [], ...section
    } as PageContentBlock;
    component.kind = {
      type: SECTION_ARCHETYPE.LIST,
      fields: {},
      variants: [{ key: 'tiles', label: 'Tiles', fields: {} }],
      surfaces: ['inherit']
    } as never;
    return component;
  }

  it('shows "No box" as a choice rather than a blank', () => {
    expect(build().activeCardGround).toBe('none');
  });

  it('shows the ink the PAGE will actually use, not an empty control', () => {
    // These defaults are duplicated in the web app's groundClasses(). If the
    // two disagree, the editor says one colour and the site draws the other.
    const component = build();

    component.pickCardGround('panel');
    expect(component.activeCardInk).toBe('dark');

    component.pickCardGround('brand');
    expect(component.activeCardInk)
      .withContext('brand defaults LIGHT - grey on this blue is ~1.4:1')
      .toBe('light');

    component.pickCardGround('dark');
    expect(component.activeCardInk).toBe('light');
  });

  it('lets a stored ink override the default', () => {
    const component = build({ cardGround: 'brand', cardInk: 'dark' });
    expect(component.activeCardInk).toBe('dark');
  });

  it('REMOVES both keys for "No box" rather than setting undefined', () => {
    // An explicitly-undefined key rejects the whole page document. The ink
    // goes too: kept, it would sit on the document forever and reappear the
    // moment a box was chosen again.
    const component = build({ cardGround: 'brand', cardInk: 'dark' });

    component.pickCardGround('none');

    expect('cardGround' in component.section).toBe(false);
    expect('cardInk' in component.section).toBe(false);
  });

  it('hides the ink lever until there is a box to put it on', () => {
    const component = build();
    expect(component.showsCardInk).toBe(false);

    component.pickCardGround('dark');
    expect(component.showsCardInk).toBe(true);
  });

  it('offers neither on a look that is not drawn as a grid', () => {
    // A carousel ignores both silently, and a control that does nothing is
    // worse than no control - the same rule Cards per row follows.
    const component = build({ variant: 'quotes' });
    component.kind = {
      type: SECTION_ARCHETYPE.LIST,
      fields: {},
      variants: [{ key: 'quotes', label: 'Quotes', fields: {} }],
      surfaces: ['inherit']
    } as never;

    expect(component.showsCardsPerRow).toBe(false);
    expect(component.showsCardInk).toBe(false);
  });
});
