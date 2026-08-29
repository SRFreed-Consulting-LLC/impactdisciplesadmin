import { Component, Input } from '@angular/core';
import { HomePageImageModel } from '@impact-common/shared/models/domain/home-page-image.model';
import { HomeSectionItem, HomeSectionModel } from '@impact-common/shared/models/domain/home-section.model';
import { HOME_SECTION_TYPES } from '@impact-common/shared/lists/home_section_types.enum';

export type PreviewDevice = 'desktop' | 'mobile';

/**
 * The WHOLE home page in miniature - every live section, in order, under the
 * site header and above the footer.
 *
 * It began (2026-08-29) as a faithful copy of the web slider alone. That was
 * the right scope while the slider was the only editable section; now that
 * the whole page is data, a preview showing one band of it answers the wrong
 * question. The point of this rail is "what will the page look like", and
 * the ORDER of the sections is the thing staff are most likely to get wrong.
 *
 * FIDELITY IS DELIBERATELY UNEVEN, and that is the trade worth knowing:
 *   - the SLIDER is drawn faithfully - same overlay, same copy block, same
 *     artwork rules - because its per-device behaviour (mobileImage,
 *     artworkHasText) cannot be judged any other way.
 *   - every other section is drawn as a recognisable BAND: right shape,
 *     right picture, right words, no attempt at the real typography. They
 *     exist here to be counted and ordered, not to be proofread.
 *
 * MIRROR any slider change into the web repo's HomeHeaderSliderComponent
 * (html + scss), and vice versa. The two are independent copies, hand-synced,
 * exactly like popup-live-preview and the web's campaign-popup.
 *
 * Every action is INERT: a CTA renders as it will but does not navigate.
 *
 * It shows SAVED state. Content is edited in dialogs that write to Firestore
 * and the screen reloads after, so the preview catches up on save rather than
 * while anything is being typed. Reordering and the Live toggle write
 * immediately, so those DO appear at once.
 */
@Component({
  selector: 'app-home-live-preview',
  templateUrl: './home-live-preview.component.html',
  styleUrls: ['./home-live-preview.component.css'],
  standalone: false
})
export class HomeLivePreviewComponent {
  readonly types = HOME_SECTION_TYPES;

  /** The whole stack, live and switched-off alike, in page order. */
  @Input() sections: readonly HomeSectionModel[] = [];

  /** Live slides, already filtered to active and sorted by order. */
  @Input() slides: readonly HomePageImageModel[] = [];

  /** Which frame to draw. Not cosmetic: mobileImage and artworkHasText only
   *  change anything at or below 991px, so this toggle is the only way to see
   *  either of them without a phone. */
  @Input() device: PreviewDevice = 'desktop';

  index = 0;

  /** What a visitor would actually get: switched-off sections are left out. */
  get liveSections(): readonly HomeSectionModel[] {
    return this.sections.filter((section) => section.isActive);
  }

  /** A section's cards, minus the switched-off ones - same rule as the site. */
  liveItems(section: HomeSectionModel): HomeSectionItem[] {
    return (section.items ?? []).filter((item) => item.isActive);
  }

  /**
   * A heading may carry markup (the book banner's <strong>), and this is a
   * miniature - so the tags are stripped rather than rendered. Using
   * innerHTML here would mean styling someone's markup inside a 40px band.
   */
  plainTitle(section: HomeSectionModel): string {
    return (section.title ?? '').replace(/<[^>]+>/g, '').trim();
  }

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

  /** Whether the slider is one of the live sections - the step controls below
   *  the frame are meaningless when it is switched off or absent. */
  get showsSlider(): boolean {
    return this.liveSections.some((section) => section.type === HOME_SECTION_TYPES.SLIDER);
  }
}
