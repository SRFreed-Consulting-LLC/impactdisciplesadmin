import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { Formio } from '@formio/js';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { LibraryLessonService } from 'src/app/common/services/data/library/library-lesson.service';
import { LibraryUnitService } from 'src/app/common/services/data/library/library-unit.service';
import { LibraryBookService } from 'src/app/common/services/data/library/library-book.service';
import { BookSeriesService } from 'src/app/common/services/data/library/book-series.service';
import { LibraryLessonImageService } from 'src/app/common/services/data/library/library-lesson-image.service';
import { ensureLibraryFormioComponentsRegistered } from 'src/app/common/services/data/library/library-formio-registration.util';
import { ensureLibraryVendorStylesheet } from 'src/app/common/services/data/library/library-vendor-stylesheet.util';
import { LibraryLessonModel } from 'src/app/common/models/domain/library/library-lesson.model';
import { LibraryUnitModel } from 'src/app/common/models/domain/library/library-unit.model';
import { LibraryBookModel } from 'src/app/common/models/domain/library/library-book.model';
import { BookSeriesModel } from 'src/app/common/models/domain/library/book-series.model';
import { LibraryFieldContext } from '@impact-common/formio/library-field.component';

/**
 * Ported from impact-discipleship-library-manager-new's
 * features/lesson-preview/lesson-preview.component.ts, with the language
 * switcher removed - Translations aren't ported yet (a later Slice 2
 * sub-step), so there's nothing to switch between yet. Re-add
 * translations()/selectedTranslationId()/onTranslationChange() and the
 * `<mat-select>` in the template once TranslationService/
 * TitleTranslationService/CommonTranslationService are ported - the
 * source component's renderForm(translation) branch shows exactly what
 * that needs.
 */
@Component({
  selector: 'app-lesson-preview',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './lesson-preview.component.html',
  styleUrl: './lesson-preview.component.scss',
})
export class LessonPreviewComponent implements OnInit, OnDestroy {
  @ViewChild('formContainer', { static: true }) formContainer!: ElementRef<HTMLDivElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly lessons = inject(LibraryLessonService);
  private readonly units = inject(LibraryUnitService);
  private readonly books = inject(LibraryBookService);
  private readonly series = inject(BookSeriesService);
  private readonly lessonImages = inject(LibraryLessonImageService);

  lessonId!: string;
  lesson: LibraryLessonModel | undefined;
  unit: LibraryUnitModel | undefined;
  book: LibraryBookModel | undefined;
  bookSeries: BookSeriesModel | undefined;
  loading = true;
  loadError: string | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private form: any;

  constructor() {
    ensureLibraryFormioComponentsRegistered();
    ensureLibraryVendorStylesheet('bootstrap.min.css');
    ensureLibraryVendorStylesheet('formio.full.min.css');
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      void this.loadLesson(id);
    }
  }

  ngOnDestroy(): void {
    this.form?.destroy?.();
  }

  backToEditor(): void {
    void this.router.navigate(['/library-manager/lessons', this.lessonId]);
  }

  private async loadLesson(id: string): Promise<void> {
    this.lessonId = id;
    this.loading = true;
    this.loadError = null;

    try {
      const lesson = await this.lessons.getById(id);
      // Resolve `lessonimage:{id}` placeholders back to real data URIs.
      const hydratedSchema = lesson ? await this.lessonImages.hydrateSchema(lesson.formSchema) : null;
      this.lesson = lesson ? { ...lesson, formSchema: hydratedSchema } : lesson;

      // Walk the ancestor chain so the "Library Field" component can offer
      // unit/book/series values too, not just the lesson's own fields.
      const unit = lesson ? await this.units.getById(lesson.unitId) : undefined;
      const book = unit ? await this.books.getById(unit.bookId) : undefined;
      const bookSeries = book ? await this.series.getById(book.seriesId) : undefined;
      this.unit = unit;
      this.book = book;
      this.bookSeries = bookSeries;

      await this.renderForm();
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
      console.error('LessonPreviewComponent failed to load lesson', id, err);
    } finally {
      this.loading = false;
    }
  }

  private buildLibraryContext(): LibraryFieldContext {
    return {
      lesson: this.lesson
        ? {
            title: this.lesson.title,
            memoryVerse: this.lesson.memoryVerse,
            dailyReadingVerse: this.lesson.dailyReadingVerse,
            goal: this.lesson.goal,
            monVerse: this.lesson.monVerse,
            tueVerse: this.lesson.tueVerse,
            wedVerse: this.lesson.wedVerse,
            thuVerse: this.lesson.thuVerse,
            friVerse: this.lesson.friVerse,
          }
        : undefined,
      unit: this.unit ? { title: this.unit.title } : undefined,
      book: this.book ? { title: this.book.title, author: this.book.author, year: this.book.year } : undefined,
      series: this.bookSeries ? { title: this.bookSeries.title } : undefined,
    };
  }

  private async renderForm(): Promise<void> {
    const schema = this.lesson?.formSchema;
    if (!schema) {
      return;
    }
    this.form?.destroy?.();
    this.form = await Formio.createForm(this.formContainer.nativeElement, schema, {
      readOnly: true,
      libraryContext: this.buildLibraryContext(),
    });
  }
}
