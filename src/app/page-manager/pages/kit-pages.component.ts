import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { PageContentModel } from '@impact-common/shared/models/domain/page-content.model';
import { DEFAULT_PAGE_THEME, SECTION_SURFACES, SectionSurface } from '@impact-common/shared/lists/section_kit';
import { PageContentService } from 'src/app/common/services/data/page-content.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { environment } from 'src/environments/environment';
import { EditablePage } from './page-section-catalogue';
import { isKitPage, kitPage } from './kit-page.adapter';
import { NewPageDialogComponent, NewPageResult } from './new-page-dialog.component';

/**
 * PAGES STAFF CREATED - the list, and the way to make another.
 *
 * WHY A LIST RATHER THAN A NAV LEAF EACH. The twelve original pages get their
 * own entry in the left nav, and that entry is CODE - `nav-config.ts`. A page
 * created here cannot have one without a deploy, which would defeat the whole
 * exercise. So they live in one screen that reads them from Firestore, and
 * the nav carries a single 'Pages' leaf that never changes.
 *
 * A DOCUMENT WITH A `title` IS A BUILDER PAGE. That is the only thing telling
 * the two apart, deliberately - see PageContentModel, where the alternative
 * (an `isBuilderPage` flag) is rejected as a second source of truth a
 * migration could set wrong. It also means this list can never accidentally
 * show one of the twelve.
 *
 * EDITING REUSES THE EXISTING STACK SCREEN. Selecting a page hands
 * `kitPage()`'s adapted EditablePage to app-page-stack, so the sections, the
 * drag-and-drop, the entry control, the auto-save and the live preview are
 * the ones already built and already tested. A second editor would be the
 * same screen with its own bugs.
 */
@Component({
  selector: 'app-kit-pages',
  templateUrl: './kit-pages.component.html',
  styleUrls: ['./kit-pages.component.css'],
  standalone: false
})
export class KitPagesComponent implements OnInit {
  pages: PageContentModel[] = [];
  loading = true;
  /** True when the read FAILED, as opposed to finding nothing. An empty list
   *  and a broken one must not look the same - one invites a New Page, the
   *  other invites a reload. */
  failed = false;

  /** The page being edited, or null while the list is showing. */
  selected: PageContentModel | null = null;

  readonly surfaces = SECTION_SURFACES.filter((s) => s.key !== 'inherit');

  constructor(
    private service: PageContentService,
    private dialog: MatDialog,
    private snackbar: SnackbarService,
    private confirm: ConfirmService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.failed = false;
    try {
      const all = await this.service.getAll();
      this.pages = all
        .filter((page) => isKitPage(page))
        .sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
    } catch (err) {
      console.error('Could not read the pages', err);
      this.failed = true;
      this.pages = [];
    } finally {
      this.loading = false;
    }
  }

  // ------------------------------------------------------------- editing

  /** The catalogue shape the existing stack screen needs. Rebuilt on each
   *  read rather than cached: it is derived, and a stale one would show the
   *  old title above the editor. */
  get selectedPage(): EditablePage | null {
    return this.selected ? kitPage(this.selected) : null;
  }

  open(page: PageContentModel): void {
    this.selected = page;
  }

  /** Back to the list, re-reading so a title or theme changed underneath is
   *  reflected rather than stale. */
  async closeEditor(): Promise<void> {
    this.selected = null;
    await this.load();
  }

  // -------------------------------------------------------------- making

  async newPage(): Promise<void> {
    const result: NewPageResult | undefined = await this.dialog
      .open(NewPageDialogComponent, {
        data: { existingSlugs: this.pages.map((p) => p.id ?? '') }
      })
      .afterClosed()
      .toPromise();

    if (!result) {
      return;
    }

    // NOT PUBLISHED, and this is the important default. A page is reachable
    // by anyone who guesses its URL the moment the document exists, and a
    // half-written page on the public site is worse than no page at all. It
    // goes live when somebody decides it is ready.
    const page = {
      id: result.slug,
      title: result.title,
      theme: { surface: result.surface, banding: false },
      isPublished: false,
      blocks: []
    } as PageContentModel;

    try {
      await this.service.update(result.slug, page);
      this.snackbar.success(`"${result.title}" created - add some sections, then publish it`);
      await this.load();
      const created = this.pages.find((p) => p.id === result.slug);
      if (created) {
        this.open(created);
      }
    } catch (err) {
      console.error('Could not create the page', err);
      this.snackbar.error('Could not create that page - try again');
    }
  }

  // ------------------------------------------------------------ settings

  async togglePublished(page: PageContentModel, next: boolean): Promise<void> {
    // A page with nothing on it renders as a bare header and footer. Better
    // to say so than to let somebody publish an empty page and wonder.
    if (next && !page.blocks?.length) {
      this.snackbar.error('Add a section before publishing - the page is empty');
      return;
    }
    await this.patch(page, { isPublished: next },
      next ? 'Live on the site' : 'Taken off the site');
  }

  async setSurface(page: PageContentModel, surface: SectionSurface): Promise<void> {
    const theme = { ...(page.theme ?? DEFAULT_PAGE_THEME), surface } as PageContentModel['theme'];
    await this.patch(page, { theme }, 'Background saved');
  }

  surfaceOf(page: PageContentModel): SectionSurface {
    return page.theme?.surface ?? DEFAULT_PAGE_THEME.surface;
  }

  /**
   * A PARTIAL write, always.
   *
   * `service.update()` is setDoc with no merge, so writing a whole page here
   * would drop whatever the section editor had saved a moment earlier. Both
   * screens edit the same document and neither owns all of it.
   */
  private async patch(
    page: PageContentModel,
    fields: Record<string, unknown>,
    message: string
  ): Promise<void> {
    const before = { ...page };
    Object.assign(page, fields);
    try {
      await this.service.updateFields(page.id ?? '', fields);
      this.snackbar.success(message);
    } catch (err) {
      console.error('Could not save that', err);
      Object.assign(page, before);
      this.snackbar.error('Could not save that - reload and try again');
    }
  }

  // ------------------------------------------------------------ removing

  async remove(page: PageContentModel): Promise<void> {
    // Says what actually happens rather than "are you sure": the page and
    // every section on it go, and any menu item pointing at it stops working
    // - which this screen cannot fix on their behalf.
    const ok = await this.confirm.confirm(
      `The page and all ${this.sectionCount(page)} of its sections will be deleted. `
      + `Anything in the menu pointing at /${page.id} will stop working. `
      + 'This cannot be undone.',
      `Delete "${page.title}"?`
    );
    if (!ok) {
      return;
    }

    try {
      await this.service.delete(page.id ?? '');
      this.snackbar.success(`"${page.title}" deleted`);
      await this.load();
    } catch (err) {
      console.error('Could not delete the page', err);
      this.snackbar.error('Could not delete that page - try again');
    }
  }

  // --------------------------------------------------------------- links

  /** Where the page lives on the public site, for THIS environment. The same
   *  `previewSiteUrl` the live previewer frames, so the two can never point
   *  at different sites - and never a hard-coded host. */
  liveUrl(page: PageContentModel): string {
    const base = (environment.previewSiteUrl || '').replace(/\/+$/, '');
    return `${base}/${page.id}`;
  }

  sectionCount(page: PageContentModel): number {
    return page.blocks?.length ?? 0;
  }

  liveSectionCount(page: PageContentModel): number {
    return (page.blocks ?? []).filter((b) => b.isActive !== false).length;
  }
}
