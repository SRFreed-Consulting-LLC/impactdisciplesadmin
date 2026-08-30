import { FormBuilder, FormGroup } from '@angular/forms';
import { ProductsComponent } from './products.component';

// The Store preview's job is to tell an admin the truth about what shoppers
// will see. Two parts of it are worth pinning because they're easy to get
// subtly wrong and the mistake looks fine on screen:
//
//   - `onSale` must use the SAME test as the storefront card (salePrice > 0).
//     If the two ever disagree, the preview shows a discount badge the real
//     card won't render, or hides one it will.
//   - `previewHiddenReason` covers the two switches that decide whether a
//     product is listed at all. They live on different tabs of this form, so
//     without this an admin can build a perfect card no shopper ever sees.
//
// Driven through the component's own getters against a real FormGroup rather
// than through the DOM - the component pulls in a dozen Firestore-backed
// services it doesn't need for this logic.
describe('ProductsComponent Store preview', () => {
  const fb = new FormBuilder();

  /** A component instance with only the state the preview getters read. */
  function componentWith(values: Record<string, unknown>): ProductsComponent {
    const component = Object.create(ProductsComponent.prototype) as ProductsComponent;
    (component as unknown as { form: FormGroup }).form = fb.group({
      isActive: [values['isActive'] ?? true],
      showInStore: [values['showInStore'] ?? true],
      title: [values['title'] ?? 'Finding Your Identity'],
      cost: [values['cost'] ?? 10],
      salePrice: [values['salePrice'] ?? 0]
    });
    component.card = values['imageUrl']
      ? { imageUrl: { url: values['imageUrl'] as string } as ProductsComponent['card']['imageUrl'] }
      : {};
    return component;
  }

  describe('pricing', () => {
    it('reads a product with no sale price as not on sale', () => {
      expect(componentWith({ salePrice: 0 }).preview.onSale).toBeFalse();
    });

    it('reads any sale price above zero as on sale, matching the storefront', () => {
      expect(componentWith({ salePrice: 0.01 }).preview.onSale).toBeTrue();
    });

    it('carries both prices through so the card can strike one out', () => {
      const preview = componentWith({ cost: 24, salePrice: 18 }).preview;
      expect(preview.cost).toBe(24);
      expect(preview.salePrice).toBe(18);
    });

    it('treats an empty or non-numeric price as zero rather than NaN', () => {
      // A cleared number field gives '' - formatted with toFixed it would
      // otherwise render "$ NaN" in the preview.
      const preview = componentWith({ cost: '', salePrice: null }).preview;
      expect(preview.cost).toBe(0);
      expect(preview.salePrice).toBe(0);
    });
  });

  describe('content', () => {
    it('passes the title through, trimmed', () => {
      expect(componentWith({ title: '  Spaced Out  ' }).preview.title).toBe('Spaced Out');
    });

    it('has no image until one is uploaded', () => {
      expect(componentWith({}).preview.imageUrl).toBeUndefined();
    });

    it('uses the uploaded image, which lives on `card` rather than the form', () => {
      expect(componentWith({ imageUrl: 'https://img.test/p.png' }).preview.imageUrl).toBe(
        'https://img.test/p.png'
      );
    });
  });

  describe('whether shoppers will actually see it', () => {
    it('says nothing when the product is live and shown in the Store', () => {
      expect(componentWith({ isActive: true, showInStore: true }).previewHiddenReason).toBeNull();
    });

    it('points at the header toggle when the product is not live', () => {
      const reason = componentWith({ isActive: false, showInStore: true }).previewHiddenReason;
      expect(reason).toContain('not live');
      expect(reason).toContain('Live toggle');
    });

    it('points at the Organization section when Show in Store is off', () => {
      const reason = componentWith({ isActive: true, showInStore: false }).previewHiddenReason;
      expect(reason).toContain('Organization');
      // A live product held back from the store is a deliberate setup, so it
      // is stated rather than framed as something being wrong.
      expect(reason).toContain('Live');
    });

    it('reports both when neither is set', () => {
      const reason = componentWith({ isActive: false, showInStore: false }) as unknown as {
        previewHiddenReason: string;
      };
      expect(reason.previewHiddenReason).toContain('not live');
      expect(reason.previewHiddenReason).toContain('Store');
    });
  });
});

// The default matters as much as the editor: both stores list a product when
// `showInStore !== false`, so an ABSENT value means shown. Defaulting the
// checkbox to false meant opening a product saved before this field had an
// editor rendered it unchecked - and saving wrote a real `false`, quietly
// pulling it from the store. Pinned here so the default can't drift back.
describe('ProductsComponent showInStore default', () => {
  function buildFormFor(item: Record<string, unknown> | undefined): boolean {
    const component = Object.create(ProductsComponent.prototype) as ProductsComponent;
    (component as unknown as { fb: FormBuilder }).fb = new FormBuilder();
    // buildForm is private; exercised through its own name rather than
    // reaching for the whole component lifecycle.
    (component as unknown as { buildForm(i: unknown): void }).buildForm(item);
    return (component as unknown as { form: FormGroup }).form.get('showInStore')?.value === true;
  }

  it('shows a brand-new product in the Store', () => {
    expect(buildFormFor(undefined)).toBeTrue();
  });

  it('shows a product saved before this field had an editor', () => {
    expect(buildFormFor({ title: 'Legacy' })).toBeTrue();
  });

  it('still honours an explicit false', () => {
    expect(buildFormFor({ title: 'Hidden', showInStore: false })).toBeFalse();
  });
});
