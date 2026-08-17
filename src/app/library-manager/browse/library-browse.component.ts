import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BookSeriesService } from 'src/app/common/services/data/library/book-series.service';
import { LibraryBookService } from 'src/app/common/services/data/library/library-book.service';
import { LibraryUnitService } from 'src/app/common/services/data/library/library-unit.service';
import { LibraryLessonService } from 'src/app/common/services/data/library/library-lesson.service';
import { LibraryEffectivePermission, LibraryPermissionService } from 'src/app/common/services/data/library/library-permission.service';
import { BookSeriesModel } from 'src/app/common/models/domain/library/book-series.model';
import { LibraryBookModel } from 'src/app/common/models/domain/library/library-book.model';
import { LibraryUnitModel } from 'src/app/common/models/domain/library/library-unit.model';
import { LibraryLessonModel } from 'src/app/common/models/domain/library/library-lesson.model';
import { LibraryNodeType } from 'src/app/common/models/domain/library/library-node-permission.model';
import { ImportBookDialogComponent } from '../dialogs/import-book-dialog.component';
import { LibraryPermissionDialogComponent } from '../dialogs/library-permission-dialog.component';

type BrowseLevel = 'series' | 'books' | 'units' | 'lessons';

const NONE: LibraryEffectivePermission = { view: false, add: false, edit: false, delete: false };

/** One row plus its own resolved permission - the row itself may still not
 *  actually be permitted; see LibraryBrowseComponent.filterVisible(). */
interface Row<T> {
  item: T;
  id: string;
  title: string;
  permission: LibraryEffectivePermission;
}

/**
 * Started as Slice 1 (Phase 2 scaffolding)'s deliberately minimal, READ-ONLY
 * drill-down through Series -> Books -> Units -> Lessons. Slice 2 wired a
 * lesson row's click to the real Lesson Editor. Slice 3 adds the Library
 * per-content-node permission system: rows a signed-in Editor has no grant
 * on (and aren't on the path to one) are filtered out entirely, and
 * Admin/Root get a "Manage Permissions" action per row - see
 * LibraryPermissionService for the propagation algorithm this mirrors
 * exactly (OR-merge down the ancestor chain, computed incrementally here as
 * each level is opened, same as the source app's own LibraryTreeComponent).
 *
 * Standalone by design (see the consolidation plan's Phase 2 "Decided -
 * module style") - imported into LibraryManagerModule's `imports` rather
 * than declared, so this and every other ported screen stay the same kind
 * of component they already are in the source app, with no rewrite.
 */
@Component({
  selector: 'app-library-browse',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatTooltipModule
  ],
  templateUrl: './library-browse.component.html',
  styleUrl: './library-browse.component.css'
})
export class LibraryBrowseComponent implements OnInit {
  loading = true;
  level: BrowseLevel = 'series';
  // Set on any read failure (most likely cause: this signed-in account has
  // no adminUsers/{uid} doc in the impactdiscipleship-books database, so
  // firestore.rules' isStaff() denies the read - a separate staff system
  // from this app's own admin_users, not yet reconciled - see the
  // consolidation plan's Phase 2 Slice 3 "Staff & permissions"). Without
  // this, a denied read left `loading` stuck true forever with nothing on
  // screen to explain why - not a missing feature, a silent failure.
  error: string | null = null;

  seriesRows: Row<BookSeriesModel>[] = [];
  bookRows: Row<LibraryBookModel>[] = [];
  unitRows: Row<LibraryUnitModel>[] = [];
  lessonRows: Row<LibraryLessonModel>[] = [];

  selectedSeries: BookSeriesModel | null = null;
  selectedBook: LibraryBookModel | null = null;
  selectedUnit: LibraryUnitModel | null = null;

  // The currently-browsed level's own resolved permission - seeds the next
  // level's effectivePermission() call as its `parent`. NONE at the series
  // level (series are root nodes, nothing above them to inherit from).
  private currentEffective: LibraryEffectivePermission = NONE;

  get isFullAccess(): boolean {
    return this.permissionService.isFullAccess();
  }

  constructor(
    private seriesService: BookSeriesService,
    private bookService: LibraryBookService,
    private unitService: LibraryUnitService,
    private lessonService: LibraryLessonService,
    private permissionService: LibraryPermissionService,
    private router: Router,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  /** A book with no `published` field at all predates the flag and is
   *  treated as published - see LibraryBookModel. Only an explicit `false`
   *  hides it, so the toggle must not read `undefined` as "off". */
  isPublished(row: Row<LibraryBookModel>): boolean {
    return row.item.published !== false;
  }

  /**
   * Publishes/unpublishes a book straight from the list row.
   *
   * Optimistic: the toggle already moved when this fires, so the model is
   * updated to match immediately and rolled back if the write fails -
   * otherwise the switch would sit in a state the database disagrees with.
   *
   * Takes no Event: MatSlideToggleChange carries no DOM event, and the row
   * is a navigation target, so the template stops click AND keydown
   * propagation on the toggle itself instead. Without the keydown half,
   * toggling with the keyboard would also fire the row's own
   * (keydown.enter)/(keydown.space) handlers and drill into the book.
   * @param {Row<LibraryBookModel>} row The book row being toggled.
   * @param {boolean} published The toggle's new position.
   * @return {Promise<void>} Resolves once persisted or rolled back.
   */
  async togglePublished(row: Row<LibraryBookModel>, published: boolean): Promise<void> {
    const seriesId = this.selectedSeries?.id;
    if (!seriesId) {
      return;
    }
    const previous = row.item.published;
    row.item.published = published;
    try {
      await this.bookService.setPublished(seriesId, row.id, published, row.title);
      this.snackBar.open(
        `${row.title} is now ${published ? 'published' : 'unpublished'}.`,
        'Dismiss',
        { duration: 3000 }
      );
    } catch (err) {
      row.item.published = previous;
      console.error('Failed to change published state:', err);
      this.snackBar.open(
        `Couldn't update ${row.title}. ${err instanceof Error ? err.message : String(err)}`,
        'Dismiss',
        { duration: 6000 }
      );
    }
  }

  ngOnInit(): void {
    this.loadSeries();
  }

  private loadSeries(): void {
    this.loading = true;
    this.error = null;
    this.currentEffective = NONE;
    this.seriesService
      .getAll()
      .then((series) => {
        this.seriesRows = this.filterVisible(
          series.sort((a, b) => a.order - b.order),
          'series',
          (s) => s.id!,
          (s) => s.title,
          NONE,
        );
        this.loading = false;
      })
      .catch((err) => this.fail(err));
  }

  openSeries(row: Row<BookSeriesModel>): void {
    this.selectedSeries = row.item;
    this.level = 'books';
    this.loading = true;
    this.error = null;
    this.currentEffective = row.permission;
    this.bookService
      .getBySeries(row.id)
      .then((books) => {
        this.bookRows = this.filterVisible(
          books.sort((a, b) => a.order - b.order),
          'book',
          (b) => b.id!,
          (b) => b.title,
          row.permission,
        );
        this.loading = false;
      })
      .catch((err) => this.fail(err));
  }

  openBook(row: Row<LibraryBookModel>): void {
    this.selectedBook = row.item;
    this.level = 'units';
    this.loading = true;
    this.error = null;
    this.currentEffective = row.permission;
    this.unitService
      .getByBook(row.id)
      .then((units) => {
        this.unitRows = this.filterVisible(
          units.sort((a, b) => a.order - b.order),
          'unit',
          (u) => u.id!,
          (u) => u.title,
          row.permission,
        );
        this.loading = false;
      })
      .catch((err) => this.fail(err));
  }

  openUnit(row: Row<LibraryUnitModel>): void {
    this.selectedUnit = row.item;
    this.level = 'lessons';
    this.loading = true;
    this.error = null;
    this.currentEffective = row.permission;
    this.lessonService
      .getByUnit(row.id)
      .then((lessons) => {
        this.lessonRows = this.filterVisible(
          lessons.sort((a, b) => a.order - b.order),
          'lesson',
          (l) => l.id!,
          (l) => l.title,
          row.permission,
        );
        this.loading = false;
      })
      .catch((err) => this.fail(err));
  }

  /** Resolves each item's own EffectivePermission (folding the parent's in)
   *  and drops any that neither has real view rights nor sits on the path
   *  down to a descendant grant - see LibraryPermissionService.isVisible(). */
  private filterVisible<T>(
    items: T[],
    nodeType: LibraryNodeType,
    getId: (item: T) => string,
    getTitle: (item: T) => string,
    parent: LibraryEffectivePermission,
  ): Row<T>[] {
    return items
      .map((item) => {
        const id = getId(item);
        const permission = this.permissionService.effectivePermission(nodeType, id, parent);
        return { item, id, title: getTitle(item), permission };
      })
      .filter((row) => this.permissionService.isVisible(row.id, row.permission));
  }

  private fail(err: unknown): void {
    this.loading = false;
    this.error = err instanceof Error ? err.message : String(err);
    console.error('LibraryBrowseComponent read failed:', err);
  }

  /** Slice 2: opens the real Lesson Editor instead of just showing the
   *  title as inert text. */
  openLesson(row: Row<LibraryLessonModel>): void {
    void this.router.navigate(['/library-manager/lessons', row.id]);
  }

  /** Admin/Root only (see the template) - opens the per-node grant editor
   *  for whichever row this was clicked on. */
  openManagePermissions(nodeType: LibraryNodeType, row: Row<unknown>, event: Event): void {
    event.stopPropagation();
    this.dialog.open(LibraryPermissionDialogComponent, {
      width: '640px',
      data: { nodeType, nodeId: row.id, nodeTitle: row.title },
    });
  }

  /** Entry point for AI Book Import - only shown at the top (series) level,
   *  matching the source app's hamburger-menu placement conceptually
   *  ("start managing the library"). Refreshes the series list on a
   *  successful import so the new (unpublished) book's series shows up
   *  immediately without a manual reload. */
  async openImportBook(): Promise<void> {
    const ref = this.dialog.open(ImportBookDialogComponent, {
      autoFocus: false,
      // The import can run for a while (a Cloud Function call per lesson) -
      // keep the dialog modal and non-dismissable so a stray click can't
      // abandon a run midway; it closes itself via its own Cancel/Done
      // buttons.
      disableClose: true,
    });
    const imported = await firstValueFrom(ref.afterClosed());
    if (imported) {
      this.loadSeries();
    }
  }

  goUp(): void {
    if (this.level === 'lessons') {
      this.level = 'units';
      this.selectedUnit = null;
    } else if (this.level === 'units') {
      this.level = 'books';
      this.selectedBook = null;
    } else if (this.level === 'books') {
      this.level = 'series';
      this.selectedSeries = null;
    }
  }
}
