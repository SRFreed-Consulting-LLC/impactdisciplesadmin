import { Injectable, inject } from '@angular/core';
import { Observable, map, shareReplay } from 'rxjs';
import { NavLeaf } from 'src/app/core/main-screen/nav-config';
import { PageContentService } from 'src/app/common/services/data/page-content.service';
import { isKitPage } from './kit-page.adapter';

/**
 * THE PAGES STAFF CREATED, AS LEFT-NAV LEAVES.
 *
 * Shane's call (2026-08-30): no difference between the pages. Every page -
 * the twelve originals and anything created in the admin - shows as its own
 * leaf under Site > Page Manager, and clicking one opens its editor. The
 * twelve get their leaves from nav-config.ts, which is code; these have to
 * come from Firestore, which is what this service is.
 *
 * A LIVE STREAM, deliberately: creating a page puts its leaf in the nav the
 * moment the document exists, and deleting one removes it, with no reload.
 * `page_content` is one document per public page - a dozen or two, read by
 * every screen in this area already - so the standing caution against
 * whole-collection streamAll() (built for thousand-row collections) does not
 * bite here.
 *
 * The leaves carry the page TITLE as the label and the SLUG as the tab key -
 * the same two things a nav-config leaf carries, so the drawer, TabShell
 * selection, deep links (?tab=<slug>) and the permission key convention
 * (page-manager.<slug>) all work unchanged. Sorted by label, so the created
 * pages read as one alphabetical run under the fixed twelve.
 */
@Injectable({ providedIn: 'root' })
export class SitePagesNavService {
  private readonly pageContent = inject(PageContentService);

  readonly leaves$: Observable<NavLeaf[]> = this.pageContent.streamAll().pipe(
    map((pages) => (pages ?? [])
      .filter((page) => isKitPage(page) && !!page.id)
      .map((page) => ({ label: page.title ?? page.id ?? '', slug: page.id ?? '' }))
      .sort((a, b) => a.label.localeCompare(b.label))
    ),
    // One Firestore listener however many consumers - the drawer and the
    // Page Manager shell both subscribe, and each nav render must not open
    // its own snapshot stream.
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /** Synchronous snapshot for template getters (the drawer renders from
   *  getters, not async pipes, throughout main-screen). Empty until the
   *  first emission lands - the drawer simply shows the static leaves. */
  leaves: NavLeaf[] = [];

  constructor() {
    this.leaves$.subscribe((leaves) => {
      this.leaves = leaves;
    });
  }
}
