import { Component, OnInit, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Observable, firstValueFrom, takeUntil } from 'rxjs';
import { PageContentModel } from '@impact-common/shared/models/domain/page-content.model';
import { PageContentService } from '../common/services/data/page-content.service';
import { NavLeaf } from '../core/main-screen/nav-config';
import { TabShellComponent } from '../core/main-screen/tab-shell.component';
import { SnackbarService } from '../shared/snackbar.service';
import { EDITABLE_PAGES, EditablePage } from './pages/page-section-catalogue';
import { NewPageDialogComponent, NewPageResult } from './pages/new-page-dialog.component';
import { SitePagesNavService } from './pages/site-pages-nav.service';

@Component({
    selector: 'app-page-manager',
    templateUrl: './page-manager.component.html',
    styleUrls: ['./page-manager.component.css'],
    standalone: false
})
export class PageManagerComponent extends TabShellComponent implements OnInit {
  protected readonly groupId = 'page-manager';

  // inject(), not constructor parameters: the base takes its deps through
  // its own constructor and this class declares none - adding one would mean
  // re-declaring all of the base's to call super. New code, house style.
  private readonly sitePagesNav = inject(SitePagesNavService);
  private readonly dialog = inject(MatDialog);
  private readonly pageContent = inject(PageContentService);
  private readonly snackbar = inject(SnackbarService);
  private readonly router = inject(Router);

  /** Guards against ?new=1 re-opening the dialog on every same-route
   *  query-param emission while it is already up. */
  private newPageDialogOpen = false;

  /** Whether the selected ORIGINAL page is showing the side-by-side
   *  comparison instead of its editor. Reset on every tab change - arriving
   *  at Seminars mid-comparison of About Us would be baffling. */
  comparing = false;

  /**
   * Pages whose comparison SHANE HAS APPROVED (his spoken verdicts,
   * 2026-08-30). An approved page drops the original-page banner and its
   * Compare button entirely - the ABSENCE is the done-marker he asked for:
   * a page still wearing the banner is one still awaiting his eyes. The
   * whole mechanism retires per page at cutover.
   */
  // The approval mechanism retired 2026-08-31: every original page has cut
  // over, so nothing is left to approve. isApproved stays true-for-all so
  // the template blocks (now iterating an empty EDITABLE_PAGES) stay inert.
  private readonly approvedPages = new Set<string>();

  isApproved(slug: string): boolean {
    return this.approvedPages.has(slug);
  }

  /**
   * Every public page, each an ordered stack of sections on one screen.
   *
   * Their nav leaves live in nav-config.ts like every other screen; this is
   * what maps the selected tab onto the right catalogue entry. About Us used
   * to have its own block here, because it was the only page whose template
   * was a dispatcher - all eleven are now, so it does not.
   */
  readonly editablePages: readonly EditablePage[] = EDITABLE_PAGES;

  /** Labels the static tab blocks already claim. A created page whose title
   *  collides is reached through the Pages list instead of a leaf - the
   *  static screens are what the permission registry knows. */
  private readonly staticLabels = new Set<string>([
    ...this.items.map((item) => item.label)
  ]);

  /** The created pages, as live extra tabs - what makes a deep link to
   *  ?tab=<created-slug> resolve once the Firestore read lands. */
  protected override extraItems$(): Observable<NavLeaf[]> {
    return this.sitePagesNav.leaves$;
  }

  /**
   * The created page the selected tab names, or null when the tab is one of
   * the static screens. Drives the ONE extra block in the template; the
   * static blocks all match on label first, so this also refusing static
   * labels means no tab can ever render twice.
   */
  get dynamicPageSlug(): string | null {
    if (!this.selectedTab || this.staticLabels.has(this.selectedTab)) {
      return null;
    }
    return this.sitePagesNav.leaves
      .find((leaf) => leaf.label === this.selectedTab)?.slug ?? null;
  }

  override ngOnInit(): void {
    super.ngOnInit();
    // A tab change leaves comparison mode - it is a per-page act.
    this.route.queryParamMap
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe(() => {
        this.comparing = false;
      });
    // The drawer's "+ New Page" row is a routerLink to ?new=1 - the dialog
    // and the create logic belong here in the lazy module, not in the shell
    // that drew the row. Watched live for the same reason the base watches
    // ?tab= live: clicking the row while already on this route is a
    // query-param-only navigation that re-fires no lifecycle hook.
    this.route.queryParamMap
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe((params) => {
        if (params.get('new') === '1' && !this.newPageDialogOpen) {
          this.openNewPageDialog();
        }
      });
  }

  private async openNewPageDialog(): Promise<void> {
    this.newPageDialogOpen = true;
    try {
      const result: NewPageResult | undefined = await firstValueFrom(
        this.dialog
          .open(NewPageDialogComponent, {
            // A FUNCTION, not the array. Read once at open time, this was
            // EMPTY on a cold load - the pages stream had not landed yet -
            // and stayed empty for the life of the dialog, so it offered to
            // create a page over the top of one that already existed. Called
            // per change-detection pass, it answers with whatever has
            // arrived by the time somebody finishes typing.
            data: { existingSlugs: () => this.sitePagesNav.leaves.map((leaf) => leaf.slug) }
          })
          .afterClosed()
      );

      if (!result) {
        // Cancelled - clear ?new=1 so the row can be clicked again and a
        // reload does not resurrect the dialog.
        this.router.navigate(['/page-manager'], { replaceUrl: true });
        return;
      }

      // THE LAST WORD BEFORE THE WRITE, and the guard that actually matters.
      //
      // `update()` is setDoc with NO MERGE, so creating a page whose slug is
      // already taken does not fail - it REPLACES that page. Its sections,
      // its title, its theme and its published flag are gone, with no undo.
      //
      // The dialog's own list is a courtesy: it tells somebody the name is
      // taken while they are still typing. It cannot be the only thing
      // standing between a typo and a destroyed page, because it is read
      // from a stream that may not have arrived. This asks the database, on
      // the way to writing to it, and is the check that cannot be raced.
      const clash = await this.pageContent.getById(result.slug);
      if (clash) {
        this.snackbar.error(
          `There is already a page at /${result.slug} - nothing was changed`
        );
        this.router.navigate(['/page-manager'],
          { queryParams: { tab: result.slug }, replaceUrl: true });
        return;
      }

      // NOT PUBLISHED, deliberately: the page is reachable by anyone who
      // guesses the URL the moment the document exists, and a half-written
      // page on the public site is worse than no page.
      const page = {
        id: result.slug,
        title: result.title,
        theme: { surface: result.surface, banding: false },
        isPublished: false,
        blocks: []
      } as PageContentModel;

      await this.pageContent.update(result.slug, page);
      this.snackbar.success(`"${result.title}" created - add some sections, then publish it`);
      // Straight into its editor; the leaf appears on its own via the
      // Firestore stream. replaceUrl so Back does not re-open the dialog.
      this.router.navigate(['/page-manager'],
        { queryParams: { tab: result.slug }, replaceUrl: true });
    } catch (err) {
      console.error('Could not create the page', err);
      this.snackbar.error('Could not create that page - try again');
      this.router.navigate(['/page-manager'], { replaceUrl: true });
    } finally {
      this.newPageDialogOpen = false;
    }
  }
}
