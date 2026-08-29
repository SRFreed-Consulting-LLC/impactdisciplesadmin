import { HomePageImageModel } from '@impact-common/shared/models/domain/home-page-image.model';
import { HomeLivePreviewComponent } from './home-live-preview.component';

// The preview exists to show the two things nothing else can: a slide's
// PHONE artwork, and what happens when its headline is baked into the
// picture. Both only apply at or below 991px on the real site, so the device
// toggle is the whole point - a preview that ignored it would be decoration.
//
// Hand-constructed; the component takes its slides as an @Input.

function slide(over: Partial<HomePageImageModel> = {}): HomePageImageModel {
  return {
    id: 's1',
    isActive: true,
    order: 0,
    title: 'The Library is now on your phone',
    image: { url: 'desktop.jpg', name: 'desktop.jpg' },
    ...over
  } as unknown as HomePageImageModel;
}

function preview(slides: HomePageImageModel[], device: 'desktop' | 'mobile' = 'desktop'): HomeLivePreviewComponent {
  const c = new HomeLivePreviewComponent();
  c.slides = slides;
  c.device = device;
  return c;
}

describe('HomeLivePreviewComponent', () => {
  describe('which picture it shows', () => {
    it('uses the desktop image on desktop', () => {
      const s = slide({ mobileImage: { url: 'phone.jpg', name: 'phone.jpg' } as never });
      expect(preview([s], 'desktop').imageUrl(s)).toBe('desktop.jpg');
    });

    it('uses the phone image on mobile when the slide has one', () => {
      const s = slide({ mobileImage: { url: 'phone.jpg', name: 'phone.jpg' } as never });
      expect(preview([s], 'mobile').imageUrl(s)).toBe('phone.jpg');
    });

    it('falls back to the desktop image on mobile when there is no phone cut', () => {
      // Every slide until someone uploads one, so this is the common path.
      const s = slide();
      expect(preview([s], 'mobile').imageUrl(s)).toBe('desktop.jpg');
    });

    it('returns an empty string rather than "undefined" when a slide has no image', () => {
      // A bare url() would render the literal text in the CSS.
      const s = slide({ image: undefined });
      expect(preview([s], 'desktop').imageUrl(s)).toBe('');
    });
  });

  describe('artwork that carries its own headline', () => {
    it('steps aside on mobile', () => {
      const s = slide({ artworkHasText: true });
      expect(preview([s], 'mobile').artworkSpeaksForItself(s)).toBe(true);
    });

    it('does NOT step aside on desktop - the frame is wide enough there', () => {
      const s = slide({ artworkHasText: true });
      expect(preview([s], 'desktop').artworkSpeaksForItself(s)).toBe(false);
    });

    it('is off for a slide that has not been ticked', () => {
      expect(preview([slide()], 'mobile').artworkSpeaksForItself(slide())).toBe(false);
    });
  });

  describe('stepping through slides', () => {
    it('wraps forwards and backwards', () => {
      const p = preview([slide({ id: 'a' }), slide({ id: 'b' }), slide({ id: 'c' })]);

      p.step(1);
      expect(p.index).toBe(1);
      p.step(-1);
      p.step(-1);
      expect(p.index).toBe(2); // wrapped past the start
      p.step(1);
      expect(p.index).toBe(0); // wrapped past the end
    });

    it('does nothing with no slides rather than dividing by zero', () => {
      const p = preview([]);
      p.step(1);
      expect(p.index).toBe(0);
      expect(p.current).toBeUndefined();
    });

    it('clamps to the last slide when the list shrinks under it', () => {
      // A staff member switches off the slide being previewed: the stream
      // re-emits shorter, and index is left pointing past the end.
      const p = preview([slide({ id: 'a' }), slide({ id: 'b' }), slide({ id: 'c' })]);
      p.select(2);
      p.slides = [slide({ id: 'a' })];
      expect(p.current?.id).toBe('a');
    });
  });
});
