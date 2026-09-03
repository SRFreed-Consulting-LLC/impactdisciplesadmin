import {
  AfterViewInit, Component, DestroyRef, ElementRef, Input, NgZone,
  OnChanges, SimpleChanges, ViewChild, inject
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PageContentBlock } from '@impact-common/shared/models/domain/page-content.model';
import { HomeSectionModel } from '@impact-common/shared/models/domain/home-section.model';
import { environment } from 'src/environments/environment';

/** Which width the framed site is told it is. Lives here rather than in a
 *  screen, because this is the component the toggle drives. */
export type PreviewDevice = 'desktop' | 'mobile';

/**
 * Either shape of section this previewer can be handed.
 *
 * The eleven page screens edit a PageContentBlock, identified by `key`; the
 * Home screen edits a HomeSectionModel, identified by `id`. This component
 * never reads either - it posts the whole thing across and the site decides -
 * so the union is honest rather than a cast at two call sites.
 */
export type PreviewSection = PageContentBlock | HomeSectionModel;

/** Where a section sits on the framed page, in the page's OWN pixels - the
 *  site measures it and posts it back; this component scales it. */
export interface SectionRect {
  key: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

/** How wide the framed site is told it is, per device. The phone width is a
 *  real one (iPhone 14 / Pixel 7 class), so the site's own breakpoints fire
 *  exactly as they do on a phone rather than at some invented width. */
const FRAME_WIDTH: Record<PreviewDevice, number> = { desktop: 1440, mobile: 390 };

/** Before the page reports its real height. Tall enough that a short page
 *  is not clipped in the moment before the first message lands. */
const ASSUMED_HEIGHT = 2400;

/**
 * The inputs that are posted INTO the running frame rather than reloading it.
 *
 * The distinction is load-bearing: a new `path`, `device` or `revision`
 * reloads the frame, but the section being typed into and the row being
 * hovered change many times a second and must not - reloading on either
 * would blank the preview between two letters, or on every mouse movement.
 */
const LIVE_INPUTS = new Set(['liveSection', 'highlightKey']);

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
 *
 * THE HOVER OUTLINE IS DRAWN HERE, NOT IN THE SITE. Hovering a row in the
 * section list outlines that section in the preview (Shane, 2026-09-02).
 * The frame is cross-origin and its pointer events are off, so the only
 * channel is postMessage - and the site is asked only WHERE the section is.
 * It answers with a rectangle in its own pixels; this component scales that
 * and draws the outline over the frame in its own CSS. Two reasons for that
 * split rather than having the site draw it: an outline drawn inside a
 * page scaled to 29% is a hairline, and drawing it out here keeps a visual
 * that only the admin ever wants out of the public site's stylesheet.
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

  /**
   * One section's key, to preview it on its own rather than the whole page.
   *
   * Passed to the site as `?section=`, which narrows the page to that block
   * and hides the header, footer and dock around it - the editor's rail is
   * showing the section being worked on, not the site it lives in.
   */
  @Input() sectionKey?: string;

  /**
   * The section AS IT IS BEING EDITED, unsaved.
   *
   * Posted into the frame so the preview shows a change before it is
   * committed. Everything else about this previewer shows saved state; this
   * is the one thing that cannot, because the whole point of it is to be
   * ahead of the save.
   */
  @Input() liveSection?: PreviewSection;

  /**
   * The section whose row is under the pointer, or null.
   *
   * Posted into the frame, which answers with where that section is; the
   * outline is then drawn here and scrolled into view. Null clears it at
   * once, without waiting for a reply - a stale outline after the pointer
   * has left is worse than none.
   */
  @Input() highlightKey: string | null = null;

  @ViewChild('rail') railRef?: ElementRef<HTMLElement>;
  @ViewChild('frame') frameRef?: ElementRef<HTMLIFrameElement>;

  src?: SafeResourceUrl;
  loaded = false;

  /** Where the hovered section is, as the site reported it. Page pixels. */
  highlight: SectionRect | null = null;

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
   *
   * THIS IS ONE THIRD OF A FEEDBACK LOOP, and knowing that is what keeps it
   * closed. The width measured here sets the scale; the scale sets the
   * stage's height; the height decides whether the rail's body needs a
   * scrollbar; and on Windows a scrollbar takes 15px OFF THE WIDTH MEASURED
   * HERE. Left alone, a page whose scaled height straddles the rail's own
   * height toggles between the two widths several times a second while it
   * loads - which is the "vibrate" Shane reported (2026-09-02, recorded at
   * frame rate: 413 -> 428 -> 413, four scrollbar appearances in 1.2s). The
   * rail breaks the loop by reserving the scrollbar's gutter permanently
   * (`scrollbar-gutter: stable` in preview-rail), so the width this observes
   * no longer depends on the height this produces. Do not "fix" the rail's
   * gutter back out for the 15px.
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

  ngOnChanges(changes: SimpleChanges): void {
    // The in-progress section and the hovered row change constantly and
    // must NOT reload the frame - they are posted into the running page
    // instead. See LIVE_INPUTS.
    if (onlyLiveInputs(changes)) {
      if (changes['liveSection']) {
        this.postLiveSection();
      }
      if (changes['highlightKey']) {
        this.postHighlight();
      }
      return;
    }

    this.loaded = false;
    this.contentHeight = ASSUMED_HEIGHT;
    // Whatever was outlined belongs to the page that is going away.
    this.highlight = null;
    // A cache-buster rather than a reload call: re-assigning src is the only
    // navigation a parent can force on a cross-origin frame.
    //
    // `adminPreview` is NOT just a cache-buster, though - the web app reads
    // it and suppresses interruptions, because a full-screen campaign popup
    // over the preview covers the very sections being arranged AND fires a
    // real impression beacon from a staff browser. See the web repo's
    // shared/utils/admin-preview.ts.
    const section = this.sectionKey ? `&section=${encodeURIComponent(this.sectionKey)}` : '';
    this.src = this.sanitizer.bypassSecurityTrustResourceUrl(
      `${this.shownUrl}?adminPreview=${this.revision}${section}`
    );
  }

  /**
   * Hands the framed page the section as it currently stands.
   *
   * Targeted at the preview site's ORIGIN rather than '*': there is no reason
   * for this to be readable by anything else that happens to be listening,
   * and the receiving side checks the sender's origin in return.
   */
  private postLiveSection(): void {
    if (!this.liveSection) {
      return;
    }
    this.postToFrame({ impactPreviewSection: this.liveSection });
  }

  /**
   * Asks the framed page where the hovered section is.
   *
   * Clearing is done HERE, immediately: a null key takes the outline down
   * without a round trip, so the outline can never outlive the hover by the
   * latency of a reply. Only a real key waits on the site's answer.
   */
  private postHighlight(): void {
    if (!this.highlightKey) {
      this.highlight = null;
    }
    this.postToFrame({ impactPreviewHighlight: this.highlightKey });
  }

  private postToFrame(message: object): void {
    const frame = this.frameRef?.nativeElement?.contentWindow;
    if (!frame) {
      return;
    }
    try {
      frame.postMessage(message, this.siteOrigin);
    } catch {
      // A frame mid-navigation, or a malformed configured URL. The next
      // keystroke posts again; a preview one edit behind beats a thrown
      // error in an editor.
    }
  }

  /** The address being framed, shown under it so nobody debugs a stale
   *  deployed build thinking it is their own work. */
  get shownUrl(): string {
    const base = environment.previewSiteUrl.replace(/\/+$/, '');
    // '/' would otherwise produce a trailing slash the other paths do not
    // have, and show as `…web.app/` in the source line.
    return this.path === '/' ? base : `${base}${this.path}`;
  }

  /** The one origin messages go to, and the one a section rectangle is
   *  believed from. */
  private get siteOrigin(): string {
    return new URL(environment.previewSiteUrl).origin;
  }

  get frameWidth(): number {
    return FRAME_WIDTH[this.device];
  }

  /**
   * How tall a slice of the page to show, before scaling.
   *
   * Set it to frame a BAND off the top rather than the whole page - the
   * Navigation screen uses it to show the site's real menu bar and nothing
   * else, across the top of the screen. Left unset, the frame is as tall as
   * the page reported itself to be, which is what every other caller wants.
   *
   * The page still LOADS in full; only the window onto it is shorter, and
   * .apv-stage already clips. That matters: the header stays the real header,
   * with the real fonts and spacing, rather than a drawing that can drift.
   */
  @Input() cropHeight?: number;

  get frameHeight(): number {
    return this.cropHeight ?? this.contentHeight;
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

  /** The hovered section's box in the STAGE's pixels - the site's rectangle
   *  put through the same scale as the frame it was measured in. */
  get highlightBox(): { top: number; left: number; width: number; height: number } | null {
    const r = this.highlight;
    if (!r) {
      return null;
    }
    const s = this.scale;
    return {
      top: Math.round(r.top * s),
      left: Math.round(r.left * s),
      width: Math.round(r.width * s),
      height: Math.round(r.height * s)
    };
  }

  onLoad(): void {
    this.loaded = true;
    // A reload starts the page from what is SAVED, so an edit in progress has
    // to be handed over again - otherwise opening a section, typing, and
    // having the frame reload for any reason would show the old wording back.
    this.postLiveSection();
    // Likewise a hover that was in place across a reload.
    if (this.highlightKey) {
      this.postHighlight();
    }
  }

  /**
   * The framed page talking to us: how tall it is, or where a section is.
   *
   * THE HEIGHT is checked by SHAPE, not by origin. The origin varies across
   * four admin environments and would be one more thing to get wrong; what
   * arrives is a number that sets a CSS height, so the worst a hostile sender
   * achieves is a badly-sized preview in their own browser. Anything that is
   * not a plausible height is ignored.
   *
   * THE RECTANGLE is checked by origin as well, because it is free here -
   * this component already knows the one origin it posts to - and because a
   * rectangle scrolls the rail, which is a little more than resizing a box.
   */
  private onChildMessage(event: MessageEvent): void {
    // `data` can be anything at all - a string, null - so it is narrowed to
    // an object before `in` is used on it, which throws on a primitive.
    const data = event.data && typeof event.data === 'object'
      ? event.data as { impactPageHeight?: unknown; impactPreviewHighlightRect?: unknown }
      : null;

    const height = data?.impactPageHeight;
    if (typeof height === 'number' && Number.isFinite(height) && height >= 200 && height <= 40000) {
      this.contentHeight = Math.ceil(height);
      return;
    }

    if (data && 'impactPreviewHighlightRect' in data && event.origin === this.siteOrigin) {
      this.takeHighlight(data.impactPreviewHighlightRect);
    }
  }

  /**
   * A reply is only believed for the section STILL under the pointer. Replies
   * arrive a round trip later than the hover, so on a fast sweep down the
   * list the answer to row three can land after row five is hovered.
   */
  private takeHighlight(value: unknown): void {
    const rect = asSectionRect(value);
    if (!rect || rect.key !== this.highlightKey) {
      return;
    }
    this.highlight = rect;
    this.revealHighlight();
  }

  /**
   * Scrolls the rail so the outlined section is in view.
   *
   * Most of a page sits below the rail's fold, so an outline on its own
   * would be invisible for most rows. 'nearest' rather than 'center': a
   * section already in view does not move at all, and one out of view moves
   * the least it can - a rail that jumped on every hover would be worse than
   * the miss it fixes. Deferred one tick so the box exists to scroll to.
   */
  private revealHighlight(): void {
    const key = this.highlightKey;
    setTimeout(() => {
      if (!key || key !== this.highlightKey) {
        return;
      }
      const box = this.railRef?.nativeElement.querySelector('.apv-highlight');
      box?.scrollIntoView({
        block: 'nearest',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth'
      });
    });
  }
}

/** True when EVERY changed input is one that is posted into the running
 *  frame rather than reloading it. See LIVE_INPUTS. */
function onlyLiveInputs(changes: SimpleChanges): boolean {
  const keys = Object.keys(changes);
  return keys.length > 0 && keys.every((key) => LIVE_INPUTS.has(key));
}

/** A shape check on what the site sent back, not a schema: four finite
 *  non-negative numbers and a key. Anything else is dropped. */
function asSectionRect(value: unknown): SectionRect | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const r = value as Record<string, unknown>;
  const nums = [r['top'], r['left'], r['width'], r['height']];
  if (typeof r['key'] !== 'string' || !r['key']) {
    return null;
  }
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100000)) {
    return null;
  }
  return {
    key: r['key'],
    top: r['top'] as number,
    left: r['left'] as number,
    width: r['width'] as number,
    height: r['height'] as number
  };
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
