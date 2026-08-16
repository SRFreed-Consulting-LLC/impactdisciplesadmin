import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { BookSeriesService } from 'src/app/common/services/data/library/book-series.service';
import { LibraryBookService } from 'src/app/common/services/data/library/library-book.service';
import { LibraryUnitService } from 'src/app/common/services/data/library/library-unit.service';
import { LibraryLessonService } from 'src/app/common/services/data/library/library-lesson.service';
import { BookSeriesModel } from 'src/app/common/models/domain/library/book-series.model';
import { LibraryBookModel } from 'src/app/common/models/domain/library/library-book.model';
import { LibraryUnitModel } from 'src/app/common/models/domain/library/library-unit.model';
import { LibraryLessonModel } from 'src/app/common/models/domain/library/library-lesson.model';
import { ImportBookDialogComponent } from '../dialogs/import-book-dialog.component';

type BrowseLevel = 'series' | 'books' | 'units' | 'lessons';

/**
 * Started as Slice 1 (Phase 2 scaffolding)'s deliberately minimal, READ-ONLY
 * drill-down through Series -> Books -> Units -> Lessons, proving the whole
 * new-module/new-nav-entry/named-database-service stack end to end. Slice 2
 * wired a lesson row's click to the real, now-ported Lesson Editor
 * (openLesson) - this screen itself still has no create/edit/delete of its
 * own for Series/Book/Unit; that (and gating by the Library per-content-node
 * grant system) arrives with a later slice.
 *
 * Standalone by design (see the consolidation plan's Phase 2 "Decided -
 * module style") - imported into LibraryManagerModule's `imports` rather
 * than declared, so this and every other ported screen stay the same kind
 * of component they already are in the source app, with no rewrite.
 */
@Component({
  selector: 'app-library-browse',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatListModule, MatProgressSpinnerModule],
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

  seriesList: BookSeriesModel[] = [];
  books: LibraryBookModel[] = [];
  units: LibraryUnitModel[] = [];
  lessons: LibraryLessonModel[] = [];

  selectedSeries: BookSeriesModel | null = null;
  selectedBook: LibraryBookModel | null = null;
  selectedUnit: LibraryUnitModel | null = null;

  constructor(
    private seriesService: BookSeriesService,
    private bookService: LibraryBookService,
    private unitService: LibraryUnitService,
    private lessonService: LibraryLessonService,
    private router: Router,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.loadSeries();
  }

  private loadSeries(): void {
    this.loading = true;
    this.error = null;
    this.seriesService
      .getAll()
      .then((series) => {
        this.seriesList = series.sort((a, b) => a.order - b.order);
        this.loading = false;
      })
      .catch((err) => this.fail(err));
  }

  openSeries(series: BookSeriesModel): void {
    this.selectedSeries = series;
    this.level = 'books';
    this.loading = true;
    this.error = null;
    this.bookService
      .getBySeries(series.id!)
      .then((books) => {
        this.books = books.sort((a, b) => a.order - b.order);
        this.loading = false;
      })
      .catch((err) => this.fail(err));
  }

  openBook(book: LibraryBookModel): void {
    this.selectedBook = book;
    this.level = 'units';
    this.loading = true;
    this.error = null;
    this.unitService
      .getByBook(book.id!)
      .then((units) => {
        this.units = units.sort((a, b) => a.order - b.order);
        this.loading = false;
      })
      .catch((err) => this.fail(err));
  }

  openUnit(unit: LibraryUnitModel): void {
    this.selectedUnit = unit;
    this.level = 'lessons';
    this.loading = true;
    this.error = null;
    this.lessonService
      .getByUnit(unit.id!)
      .then((lessons) => {
        this.lessons = lessons.sort((a, b) => a.order - b.order);
        this.loading = false;
      })
      .catch((err) => this.fail(err));
  }

  private fail(err: unknown): void {
    this.loading = false;
    this.error = err instanceof Error ? err.message : String(err);
    console.error('LibraryBrowseComponent read failed:', err);
  }

  /** Slice 2: opens the real Lesson Editor instead of just showing the
   *  title as inert text. */
  openLesson(lesson: LibraryLessonModel): void {
    void this.router.navigate(['/library-manager/lessons', lesson.id]);
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
