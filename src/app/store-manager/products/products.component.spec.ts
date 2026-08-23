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
      expect(reason).toContain('Not live');
    });

    it('points at the Organization tab when Show in Store is off', () => {
      const reason = componentWith({ isActive: true, showInStore: false }).previewHiddenReason;
      expect(reason).toContain('Organization');
    });

    it('reports both when neither is set', () => {
      const reason = componentWith({ isActive: false, showInStore: false }) as unknown as {
        previewHiddenReason: string;
      };
      expect(reason.previewHiddenReason).toContain('Not live');
      expect(reason.previewHiddenReason).toContain('Store');
    });
  });
});
