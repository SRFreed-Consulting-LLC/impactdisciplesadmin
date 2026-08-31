import {
  AfterViewInit, Component, ElementRef, HostListener, Input, OnChanges, ViewChild, inject
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { environment } from 'src/environments/environment';

/**
 * ONE page, drawn both ways, side by side.
 *
 * LEFT: the page as it is now, drawn from the fourteen archetypes.
 * RIGHT: /kit-preview/<slug> - the same document flipped through
 * toSectionBlocks() in memory and drawn from the two members that replace
 * them. The flip is the migration's own transform, so what the right side
 * shows is what approving the migration would produce. Nothing on this
 * screen changes anything.
 *
 * SECOND TIME OF ASKING. This component came through the first cutover -
 * nine bespoke page components into fourteen archetypes - and was left in
 * the tree when its route retired. Everything it learned then still holds,
 * which is why only these words changed.
 *
 * TWO PLAIN IFRAMES, deliberately - not the postMessage-driven live
 * previewer. That component exists to swap unsaved edits into a frame; this
 * screen compares two SAVED renderings, and the simplest thing that can
 * show them is the honest one. Each side scrolls itself.
 */
@Component({
  selector: 'app-kit-compare',
  templateUrl: './kit-compare.component.html',
  styleUrls: ['./kit-compare.component.css'],
  standalone: false
})
export class KitCompareComponent implements OnChanges, AfterViewInit {
  private readonly sanitizer = inject(DomSanitizer);

  /**
   * Each frame renders the site at FULL DESKTOP WIDTH and is scaled down to
   * fit its pane. Without this the frames were ~900px wide, the site laid
   * itself out responsively, and Shane was comparing two phone-ish reflows
   * to his memory of a desktop - columns broke to the next row and nothing
   * lined up with the real site.
   */
  readonly desktopWidth = 1600;
  scale = 0.5;
  frameCssHeight = 2000;

  @ViewChild('viewport') private viewport?: ElementRef<HTMLElement>;

  ngAfterViewInit(): void {
    // The panes are laid out by the grid, so their width only exists after
    // the first render.
    setTimeout(() => this.rescale());
  }

  @HostListener('window:resize')
  rescale(): void {
    const el = this.viewport?.nativeElement;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) {
      this.scale = rect.width / this.desktopWidth;
      // The frame's CSS height is the visible height UN-scaled, so that
      // after scaling it exactly fills the viewport box.
      this.frameCssHeight = rect.height / this.scale;
    }
  }

  /** The page's public path, e.g. '/lunch-and-learns'. */
  @Input({ required: true }) path!: string;
  /** Its page_content document id. */
  @Input({ required: true }) slug!: string;

  /**
   * STORED FIELDS, built once per input change - never getters.
   *
   * The getter version of these made both frames BLINK: a getter builds a
   * fresh SafeResourceUrl OBJECT on every change-detection pass, Angular
   * compares by reference, sees a "new" src each time, re-sets it - and
   * setting an iframe's src reloads the iframe. Every CD cycle, forever.
   * Same referential-stability rule as the kitPage() freeze earlier today:
   * anything bound into the template must keep its identity unless it
   * genuinely changed.
   */
  liveUrl: SafeResourceUrl | null = null;
  kitUrl: SafeResourceUrl | null = null;

  ngOnChanges(): void {
    const base = (environment.previewSiteUrl || '').replace(/\/+$/, '');
    // bypassSecurityTrustResourceUrl is safe here BECAUSE the base is the
    // environment's own preview site and the path/slug come from the static
    // catalogue, never from user input.
    this.liveUrl = this.sanitizer.bypassSecurityTrustResourceUrl(`${base}${this.path}`);
    // ?framed=1: the preview wears the same site header and footer as the
    // live page and drops its ribbon, so the two frames start identically -
    // the labels above the frames say which side is which.
    this.kitUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
      `${base}/kit-preview/${this.slug}?framed=1`
    );
  }
}
