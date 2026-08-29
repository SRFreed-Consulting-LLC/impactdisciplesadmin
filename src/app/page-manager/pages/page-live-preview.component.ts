import {
  AfterViewInit, Component, DestroyRef, ElementRef, Input, NgZone,
  OnChanges, ViewChild, inject
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { environment } from 'src/environments/environment';

/** Which width the framed site is told it is. Lives here rather than in a
 *  screen, because this is the component the toggle drives. */
export type PreviewDevice = 'desktop' | 'mobile';

/** How wide the framed site is told it is, per device. The phone width is a
 *  real one (iPhone 14 / Pixel 7 class), so the site's own breakpoints fire
 *  exactly as they do on a phone rather than at some invented width. */
const FRAME_WIDTH: Record<PreviewDevice, number> = { desktop: 1440, mobile: 390 };

/** Before the page reports its real height. Tall enough that a short page
 *  is not clipped in the moment before the first message lands. */
const ASSUMED_HEIGHT = 2400;

/**
 * The public page itself, in a scaled frame.
 *
 * THIS USED TO BE A DRAWING. Until 2026-08-29 it was a miniature built from
 * the same section list - recognisable bands, right order, right pictures,
 * right words, its own typography. Shane asked why it did not look like the
 * page, and the honest answer was that four of the differences were not the
 * trade at all, they were mine: the buttons were blue where the site's are
 * white, the gold emphasis in every heading was stripped, it drew a yellow
 * rule under a heading that has none on these pages (an About Us element
 * leaking through a shared shape), and the consultation banner - a 200px
 * photo band - was a 45px grey strip. The proportions were off too: the
 * two-column block took 47% of the preview where it takes 30% of the page.
 *
 * A drawing of another application drifts from it, and every one of those
 * five was drift. So it is the real page now, which cannot drift, and every
 * class of bug above stops being possible rather than being fixed.
 *
 * WHAT IT SHOWS IS SAVED STATE, and that is fine here rather than a
 * compromise: this screen writes the moment anything changes - reordering, a
 * Live toggle and a dialog Save all persist immediately - so there is no
 * unsaved state for it to miss. The frame reloads after each write.
 *
 * WHICH SITE IT FRAMES is environment.previewSiteUrl, which pairs with the
 * admin you are running: locally your own web server on 4200, and the
 * deployed public site from a deployed admin. THE CAVEAT WORTH KNOWING: a
 * deployed admin frames a DEPLOYED web build, so between shipping this admin
 * and shipping the web app the preview shows the old site reading the new
 * data. That is the same deploy-order hazard MIGRATION.md opens with, seen
 * from another side, and it is why the frame names the address it is showing.
 */
@Component({
  selector: 'app-page-live-preview',
  templateUrl: './page-live-preview.component.html',
  styleUrls: ['./page-live-preview.component.css'],
  standalone: false
})
export class PageLivePreviewComponent implements OnChanges, AfterViewInit {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);

  /**
   * The public route to frame - '/about-us', or '/' for the home page.
   *
   * A path and a name rather than an EditablePage, so the HOME screen can use
   * this too: home is not in EDITABLE_PAGES (its sections are their own
   * collection with their own catalogue) but it is the same public site and
   * deserves the same preview.
   */
  @Input({ required: true }) path!: string;

  /** What to call it while it loads. */
  @Input() label = 'the page';

  @Input() device: PreviewDevice = 'desktop';

  /**
   * Bumped by the stack screen after every write. Changing it reloads the
   * frame - which is the only way to refresh a cross-origin child, since
   * contentWindow.location is not reachable from here.
   */
  @Input() revision = 0;

  @ViewChild('rail') railRef?: ElementRef<HTMLElement>;

  src?: SafeResourceUrl;
  loaded = false;

  /** The page's own height, as it reported it. */
  private contentHeight = ASSUMED_HEIGHT;

  /** How much of the rail the frame has to fit into, measured on the host. */
  private railWidth = 430;

  constructor() {
    const onMessage = (event: MessageEvent) => this.onChildMessage(event);
    window.addEventListener('message', onMessage);
    this.destroyRef.onDestroy(() => window.removeEventListener('message', onMessage));
  }

  /**
   * The scale follows the rail's ACTUAL width rather than the 430px the
   * stylesheet asks for, because that number changes: the rail becomes
   * full-width below 1400px, where a fixed divisor would render the page at
   * a third of the space it has.
   */
  ngAfterViewInit(): void {
    const rail = this.railRef?.nativeElement;
    if (!rail || typeof ResizeObserver === 'undefined') {
      return;
    }
    this.zone.runOutsideAngular(() => {
      const observer = new ResizeObserver(([entry]) => {
        const width = Math.round(entry.contentRect.width);
        // Back inside the zone so change detection runs; this component uses
        // the default strategy, so re-entering IS the notification and a
        // markForCheck would be a node-scoped dependency bought for nothing.
        if (width > 0 && width !== this.railWidth) {
          this.zone.run(() => {
            this.railWidth = width;
          });
        }
      });
      observer.observe(rail);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  ngOnChanges(): void {
    this.loaded = false;
    this.contentHeight = ASSUMED_HEIGHT;
    // A cache-buster rather than a reload call: re-assigning src is the only
    // navigation a parent can force on a cross-origin frame.
    //
    // `adminPreview` is NOT just a cache-buster, though - the web app reads
    // it and suppresses interruptions, because a full-screen campaign popup
    // over the preview covers the very sections being arranged AND fires a
    // real impression beacon from a staff browser. See the web repo's
    // shared/utils/admin-preview.ts.
    this.src = this.sanitizer.bypassSecurityTrustResourceUrl(
      `${this.shownUrl}?adminPreview=${this.revision}`
    );
  }

  /** The address being framed, shown under it so nobody debugs a stale
   *  deployed build thinking it is their own work. */
  get shownUrl(): string {
    const base = environment.previewSiteUrl.replace(/\/+$/, '');
    // '/' would otherwise produce a trailing slash the other paths do not
    // have, and show as `…web.app/` in the source line.
    return this.path === '/' ? base : `${base}${this.path}`;
  }

  get frameWidth(): number {
    return FRAME_WIDTH[this.device];
  }

  get frameHeight(): number {
    return this.contentHeight;
  }

  /**
   * Scaled to whatever width the rail actually has, so the frame is a true
   * reduction of the page rather than a fixed guess.
   *
   * NEVER ENLARGED. A 390px phone in a 430px rail would otherwise be blown up
   * to 110%, which is not what a phone looks like and makes the type read as
   * bigger than it is. Below 1:1 it shrinks; at or above, it sits at natural
   * size and is centred.
   */
  get scale(): number {
    return Math.min(1, this.railWidth / this.frameWidth);
  }

  /** A transform does not change layout, so the wrapper has to reserve the
   *  scaled box itself or the source line would sit under the frame. */
  get scaledHeight(): number {
    return Math.round(this.frameHeight * this.scale);
  }

  get scaledWidth(): number {
    return Math.round(this.frameWidth * this.scale);
  }

  onLoad(): void {
    this.loaded = true;
  }

  /**
   * The framed page telling us how tall it is.
   *
   * Checked by SHAPE, not by origin. The origin varies across four admin
   * environments and would be one more thing to get wrong; what arrives is a
   * number that sets a CSS height, so the worst a hostile sender achieves is
   * a badly-sized preview in their own browser. Anything that is not a
   * plausible height is ignored.
   */
  private onChildMessage(event: MessageEvent): void {
    const height = (event.data as { impactPageHeight?: unknown })?.impactPageHeight;
    if (typeof height !== 'number' || !Number.isFinite(height) || height < 200 || height > 40000) {
      return;
    }
    this.contentHeight = Math.ceil(height);
  }
}
