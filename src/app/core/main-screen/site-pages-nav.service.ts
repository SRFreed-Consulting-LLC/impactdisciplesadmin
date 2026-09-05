import { Injectable, inject } from '@angular/core';
import { Observable, map, shareReplay } from 'rxjs';
import { NavLeaf } from 'src/app/core/main-screen/nav-config';
import { PageContentService } from 'src/app/common/services/data/page-content.service';
// The one page-manager import core keeps: a pure "is this a kit page"
// predicate over a page_content document, which belongs with the page
// kit's own adapter rather than with the drawer.
import { isKitPage } from 'src/app/page-manager/pages/kit-page.adapter';

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

  /**
   * THE one Firestore listener, and everything below is a projection of it.
   *
   * Until 2026-09-05 leaves$ and pages$ each called streamAll() and each
   * carried a comment claiming they shared a stream. They did not:
   * FirebaseDAO.streamAll() builds a fresh collectionData(query(collection(
   * ...))) on every call, so it is COLD - one observable per invocation - and
   * both were shareReplay'd with refCount:false and subscribed in the
   * constructor, so both stayed open for the whole session. Two permanent
   * onSnapshot listeners on page_content where the design intends one, and
   * the second existed only to add a boolean the first already had in hand.
   */
  private readonly kitPages$ = this.pageContent.streamAll().pipe(
    map((pages) => (pages ?? []).filter((page) => isKitPage(page) && !!page.id)),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  readonly leaves$: Observable<NavLeaf[]> = this.kitPages$.pipe(
    map((pages) => pages
      .map((page) => ({ label: page.title ?? page.id ?? '', slug: page.id ?? '' }))
      // HOME FIRST, then alphabetical. It became an ordinary kit page on
      // 2026-08-31 and would otherwise sort between Give and Lunch and
      // Learns - the site's front page, and the most-edited screen here,
      // buried in the middle of the list.
      .sort((a, b) => {
        if (a.slug === 'home' || b.slug === 'home') {
          return a.slug === 'home' ? -1 : 1;
        }
        return a.label.localeCompare(b.label);
      })
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

  /**
   * THE SAME PAGES, FOR THE MENU PICKER, carrying the one extra thing it
   * needs: whether the page is actually on the site.
   *
   * Separate from `leaves` because NavLeaf is the PERMISSION REGISTRY's
   * type - its fields are screen keys and roles, and a published flag has no
   * business there. The menu picker cares because a menu item pointing at an
   * unpublished page sends every visitor to Page Not Found.
   *
   * Projected off kitPages$, so this genuinely opens no second Firestore
   * listener - which is what this line claimed and did not deliver until
   * 2026-09-05.
   */
  readonly pages$: Observable<CreatedPage[]> = this.kitPages$.pipe(
    map((pages) => pages
      .map((page): CreatedPage => ({
        slug: page.id ?? '',
        title: page.title ?? page.id ?? '',
        // Pages written before the flag existed have no `isPublished` and
        // are served, so absent means published - the same reading the
        // public site's own route takes.
        isPublished: page.isPublished !== false
      }))
      .sort((a, b) => a.title.localeCompare(b.title))
    ),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /** Synchronous snapshot, for the same reason as `leaves`. */
  pages: CreatedPage[] = [];

  constructor() {
    this.leaves$.subscribe((leaves) => {
      this.leaves = leaves;
    });
    this.pages$.subscribe((pages) => {
      this.pages = pages;
    });
  }
}

/** A page staff created, as the menu picker needs to see it. */
export interface CreatedPage {
  slug: string;
  title: string;
  isPublished: boolean;
}
