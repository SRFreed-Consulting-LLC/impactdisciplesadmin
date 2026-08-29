import { Component, Input } from '@angular/core';
import { HomePageImageModel } from '@impact-common/shared/models/domain/home-page-image.model';

export type PreviewDevice = 'desktop' | 'mobile';

/**
 * A faithful copy of the WEB repo's home-header-slider - same overlay, same
 * copy block, same artwork rules - so staff can see what a visitor sees
 * rather than an approximation of it.
 *
 * MIRROR any change here into the web repo's HomeHeaderSliderComponent
 * (html + scss), and vice versa. The two are independent copies, hand-synced,
 * exactly like popup-live-preview and the web's campaign-popup.
 *
 * Deliberate differences from the real slider, all so it is USABLE as an
 * editing aid rather than a demo:
 *   - No Swiper and no autoplay. A slide that moves on its own while you are
 *     reading it is a nuisance in an editor; you step through instead.
 *   - Every action is INERT: the CTA renders exactly as it will but does not
 *     navigate.
 *
 * It shows SAVED state. Slides are edited in a dialog that writes to
 * Firestore, and the stream this is bound to updates on that write - so the
 * preview catches up the moment a slide is saved, not while it is being
 * typed.
 */
@Component({
  selector: 'app-home-live-preview',
  templateUrl: './home-live-preview.component.html',
  styleUrls: ['./home-live-preview.component.css'],
  standalone: false
})
export class HomeLivePreviewComponent {
  /** Live slides, already filtered to active and sorted by order. */
  @Input() slides: readonly HomePageImageModel[] = [];

  /** Which frame to draw. Not cosmetic: mobileImage and artworkHasText only
   *  change anything at or below 991px, so this toggle is the only way to see
   *  either of them without a phone. */
  @Input() device: PreviewDevice = 'desktop';

  index = 0;

  get current(): HomePageImageModel | undefined {
    return this.slides[Math.min(this.index, Math.max(0, this.slides.length - 1))];
  }

  get isMobile(): boolean {
    return this.device === 'mobile';
  }

  /**
   * The picture this slide shows at the previewed width - the same rule as
   * the web slider's slideImageUrl(), with the device toggle standing in for
   * window.innerWidth.
   */
  imageUrl(slide: HomePageImageModel | undefined): string {
    if (!slide) {
      return '';
    }
    return (this.isMobile && slide.mobileImage?.url) || slide.image?.url || '';
  }

  /** True when the artwork carries its own headline AND we are at a width
   *  where the site steps aside for it - phones and tablets only. */
  artworkSpeaksForItself(slide: HomePageImageModel | undefined): boolean {
    return !!slide?.artworkHasText && this.isMobile;
  }

  select(i: number): void {
    this.index = i;
  }

  step(by: number): void {
    if (!this.slides.length) {
      return;
    }
    this.index = (this.index + by + this.slides.length) % this.slides.length;
  }
}
