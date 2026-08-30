import { Component, Input } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { inject } from '@angular/core';
import { environment } from 'src/environments/environment';

/**
 * ONE original page, drawn both ways, side by side.
 *
 * LEFT: the live page, exactly as its bespoke component renders it today.
 * RIGHT: /kit-preview/<slug> - the same document flipped through
 * toKitBlocks() in memory and drawn by the section kit. The flip is the
 * migration's own transform, so what the right side shows is what approving
 * the migration would produce. Nothing on this screen changes anything.
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
export class KitCompareComponent {
  private readonly sanitizer = inject(DomSanitizer);

  /** The page's public path, e.g. '/lunch-and-learns'. */
  @Input({ required: true }) path!: string;
  /** Its page_content document id. */
  @Input({ required: true }) slug!: string;

  private url(suffix: string): SafeResourceUrl {
    const base = (environment.previewSiteUrl || '').replace(/\/+$/, '');
    // bypassSecurityTrustResourceUrl is safe here BECAUSE the base is the
    // environment's own preview site and the path/slug come from the static
    // catalogue, never from user input.
    return this.sanitizer.bypassSecurityTrustResourceUrl(`${base}${suffix}`);
  }

  get liveUrl(): SafeResourceUrl {
    return this.url(this.path);
  }

  get kitUrl(): SafeResourceUrl {
    // ?framed=1: the preview wears the same site header and footer as the
    // live page and drops its ribbon, so the two frames start identically -
    // the labels above the frames are what says which side is which.
    return this.url(`/kit-preview/${this.slug}?framed=1`);
  }
}
