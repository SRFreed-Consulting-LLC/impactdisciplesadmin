import { Component, Input, OnChanges, inject } from '@angular/core';
import { PageContentModel } from '@impact-common/shared/models/domain/page-content.model';
import { PageContentService } from 'src/app/common/services/data/page-content.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { environment } from 'src/environments/environment';
import { EditablePage } from './page-section-catalogue';
import { kitPage } from './kit-page.adapter';

/**
 * ONE created page, opened from its own leaf in the left nav.
 *
 * Shane's call (2026-08-30): every page - original or created - is a leaf
 * under Site > Page Manager, and clicking it opens its editor on the right.
 * The twelve originals get that from EDITABLE_PAGES and the tab blocks in
 * page-manager.component.html; a created page gets it from this component,
 * which is only the loading shell around the SAME app-page-stack editor.
 *
 * The Pages screen keeps its own copy of this flow for editing out of the
 * list; this exists so a leaf needs nothing but a slug.
 */
@Component({
  selector: 'app-kit-page-editor',
  templateUrl: './kit-page-editor.component.html',
  styleUrls: ['./kit-pages.component.css'],
  standalone: false
})
export class KitPageEditorComponent implements OnChanges {
  private readonly service = inject(PageContentService);
  private readonly snackbar = inject(SnackbarService);

  /** The page_content document id. Rebinding it loads the new page -
   *  ngOnChanges, because the leaf clicks are same-route query-param
   *  navigations that reuse this instance. */
  @Input({ required: true }) slug!: string;

  page: PageContentModel | null = null;

  /**
   * The adapted catalogue page app-page-stack takes. A STORED FIELD, never a
   * getter - a getter returning a fresh kitPage() per read re-fires the
   * stack's ngOnChanges forever and freezes the tab. The bug that shipped
   * once already; see kit-pages.component.ts.
   */
  editablePage: EditablePage | null = null;

  loading = true;
  failed = false;

  ngOnChanges(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.failed = false;
    this.page = null;
    this.editablePage = null;
    try {
      const doc = await this.service.getById(this.slug);
      if (doc?.title) {
        this.page = doc;
        this.editablePage = kitPage(doc);
      } else {
        // No document, or one of the twelve originals - either way this leaf
        // has nothing to edit. Failed rather than blank, so a deleted page's
        // stale leaf says something.
        this.failed = true;
      }
    } catch (err) {
      console.error(`Page ${this.slug}: could not load`, err);
      this.failed = true;
    } finally {
      this.loading = false;
    }
  }

  /** Live/draft, saved immediately - the same partial write the Pages list
   *  uses, for the same reason: this screen does not own the whole document. */
  async togglePublished(next: boolean): Promise<void> {
    if (!this.page) {
      return;
    }
    if (next && !this.page.blocks?.length) {
      this.snackbar.error('Add a section before publishing - the page is empty');
      return;
    }
    const before = this.page.isPublished;
    this.page.isPublished = next;
    try {
      await this.service.updateFields(this.slug, { isPublished: next });
      this.snackbar.success(next ? 'Live on the site' : 'Taken off the site');
    } catch (err) {
      console.error('Could not save that', err);
      this.page.isPublished = before;
      this.snackbar.error('Could not save that - reload and try again');
    }
  }

  get liveUrl(): string {
    const base = (environment.previewSiteUrl || '').replace(/\/+$/, '');
    return `${base}/${this.slug}`;
  }
}
