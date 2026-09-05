import { TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { PageContentItem } from '@impact-common/shared/models/domain/page-content.model';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import { PageEntryDialogComponent, PageEntryDialogData } from './page-entry-dialog.component';

/**
 * ONE ENTRY'S FIELDS.
 *
 * The component shipped on 2026-09-05 with no spec, and it carries two
 * hazards that fail a long way from where they are caused.
 *
 * THE FIRST IS THE `undefined` TRAP. A key explicitly set to undefined
 * rejects the ENTIRE Firestore write, however deep it sits - so getting this
 * wrong does not break the dialog, it breaks the page's Save, later, from a
 * different screen, with a message naming no field a human recognises.
 * CLAUDE.md records that trap costing a live diagnosis session once already,
 * and the section editor has a spec for exactly this on its column levers.
 * The dialog inherited the hazard without inheriting the test.
 *
 * THE SECOND IS THE FOCAL POINT, which is written to Firestore and read by
 * the WEB app's CSS `object-position`. An out-of-range percentage crops the
 * photo off-frame on the public site, silently.
 */
describe('the entry dialog', () => {
  let closed: PageContentItem | undefined | 'not-closed';

  function build(
    entry: Partial<PageContentItem>,
    spec: Partial<PageEntryDialogData['spec']> = {},
    isNew = false
  ): PageEntryDialogComponent {
    closed = 'not-closed';
    const data: PageEntryDialogData = {
      entry: { isActive: true, ...entry } as PageContentItem,
      spec: {
        noun: 'card',
        fields: { image: true, title: true, description: true },
        ...spec
      } as PageEntryDialogData['spec'],
      index: 0,
      chip: '01',
      side: '',
      isNew
    };
    TestBed.configureTestingModule({
      providers: [
        PageEntryDialogComponent,
        { provide: MAT_DIALOG_DATA, useValue: data },
        {
          provide: MatDialogRef,
          useValue: { close: (v: PageContentItem | undefined) => (closed = v) }
        }
      ]
    });
    return TestBed.inject(PageEntryDialogComponent);
  }

  const picture = { name: 'Shared/x', url: 'https://example.test/x.png' } as ImageModel;

  // ------------------------------------------------- the undefined trap

  it('REMOVES the picture key rather than setting it to undefined', () => {
    // `image: undefined` and no `image` key at all are the same thing in
    // JavaScript and emphatically not the same thing to Firestore: the first
    // rejects the whole page document.
    const component = build({ title: 'A card', image: picture });

    component.showImageUploader();
    component.card.image = undefined;   // the picker was closed with nothing chosen
    component.closeImageUploader();

    expect('image' in component.entry).toBe(false);
    expect(component.entry.image).toBeUndefined();   // true either way - the line above is the real assertion
  });

  it('keeps a picture that was actually chosen', () => {
    const component = build({ title: 'A card' });

    component.showImageUploader();
    component.card.image = picture;
    component.closeImageUploader();

    expect(component.entry.image).toBe(picture);
  });

  it('never leaves the staging object holding the picture', () => {
    // `card` is what the uploader writes into. Left populated, the next open
    // of the picker shows the previous entry's photograph as if it were this
    // one's.
    const component = build({ title: 'A card' });
    component.showImageUploader();
    component.card.image = picture;
    component.closeImageUploader();

    expect(component.card.image).toBeUndefined();
  });

  it('drops the crop with the picture it belonged to', () => {
    // A focal point left behind is inherited by the NEXT photograph uploaded
    // into this entry, which crops a different picture to a face that is no
    // longer there.
    const component = build({
      title: 'A card', image: picture, photoFocusPoint: { x: 20, y: 80 }
    });

    component.clearImage();

    expect('image' in component.entry).toBe(false);
    expect('photoFocusPoint' in component.entry).toBe(false);
  });

  // ------------------------------------------------------ the focal point

  it('defaults to the middle when there is no point, and never invents one', () => {
    const component = build({ title: 'A card', image: picture });

    expect(component.focusPoint).toEqual({ x: 50, y: 50 });
    // Reading it must not WRITE it - an absent point means "the card's own
    // default crop", which is not the same as a centred one.
    expect('photoFocusPoint' in component.entry).toBe(false);
  });

  it('ignores a stored point that is not a pair of numbers', () => {
    const component = build({
      title: 'A card',
      photoFocusPoint: { x: NaN, y: 10 } as { x: number; y: number }
    });

    expect(component.focusPoint).toEqual({ x: 50, y: 50 });
  });

  it('clamps a nudge to the edges of the picture', () => {
    // These percentages become CSS object-position on the public site. A
    // negative one crops the photograph off-frame.
    const component = build({
      title: 'A card', photoFocusPoint: { x: 2, y: 98 }
    });

    component.nudgeFocus(-50, 50);
    expect(component.entry.photoFocusPoint).toEqual({ x: 0, y: 100 });

    component.nudgeFocus(500, -500);
    expect(component.entry.photoFocusPoint).toEqual({ x: 100, y: 0 });
  });

  it('leaves the point alone when the picture has no size yet', () => {
    // A drag that arrives before layout would otherwise divide by zero and
    // write NaN into Firestore.
    const component = build({ title: 'A card' });
    const event = {
      currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) },
      clientX: 10,
      clientY: 10
    } as unknown as PointerEvent;

    component.moveFocus(event);

    expect('photoFocusPoint' in component.entry).toBe(false);
  });

  it('puts the point where the pointer is, as a percentage', () => {
    const component = build({ title: 'A card' });
    const event = {
      currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 200, width: 400, height: 200 }) },
      clientX: 200,
      clientY: 250
    } as unknown as PointerEvent;

    component.moveFocus(event);

    expect(component.entry.photoFocusPoint).toEqual({ x: 25, y: 25 });
  });

  it('resets to the ABSENCE of a point, not a centred one', () => {
    const component = build({ title: 'A card', photoFocusPoint: { x: 10, y: 10 } });

    component.clearFocus();

    expect('photoFocusPoint' in component.entry).toBe(false);
  });

  // ------------------------------------------------------- save / cancel

  it('hands the edited entry back on Done, and nothing on Cancel', () => {
    // Cancel-really-cancels is the single behavioural promise of the whole
    // redesign. The opener discards a falsy result, so `undefined` here is
    // what makes an abandoned edit leave no trace.
    const component = build({ title: 'A card' });

    component.cancel();
    expect(closed).toBeUndefined();

    component.entry.title = 'Renamed';
    component.save();
    expect(closed).toBe(component.entry);
    expect((closed as PageContentItem).title).toBe('Renamed');
  });

  // ONE build() per spec: TestBed cannot be reconfigured once it has handed
  // out an instance, so these are two specs rather than two assertions.
  it('titles itself for a new entry', () => {
    expect(build({ title: 'x' }, {}, true).title).toBe('New card');
  });

  it('titles itself for an existing one', () => {
    expect(build({ title: 'x' }, {}, false).title).toBe('Edit this card');
  });
});
