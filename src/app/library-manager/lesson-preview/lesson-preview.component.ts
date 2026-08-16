import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Formio } from '@formio/js';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { LibraryLessonService } from 'src/app/common/services/data/library/library-lesson.service';
import { LibraryUnitService } from 'src/app/common/services/data/library/library-unit.service';
import { LibraryBookService } from 'src/app/common/services/data/library/library-book.service';
import { BookSeriesService } from 'src/app/common/services/data/library/book-series.service';
import { LibraryLessonImageService } from 'src/app/common/services/data/library/library-lesson-image.service';
import { LibraryTranslationService } from 'src/app/common/services/data/library/library-translation.service';
import { LibraryTitleTranslationService } from 'src/app/common/services/data/library/library-title-translation.service';
import { LibraryCommonTranslationService } from 'src/app/common/services/data/library/library-common-translation.service';
import { ensureLibraryFormioComponentsRegistered } from 'src/app/common/services/data/library/library-formio-registration.util';
import { ensureLibraryVendorStylesheet } from 'src/app/common/services/data/library/library-vendor-stylesheet.util';
import { extractTranslatableFields } from '@impact-common/formio/form-translation.util';
import { CommonTranslation, LessonTranslation, TitleTranslation } from '@impact-common/models/translation.models';
import { LibraryLessonModel } from 'src/app/common/models/domain/library/library-lesson.model';
import { LibraryUnitModel } from 'src/app/common/models/domain/library/library-unit.model';
import { LibraryBookModel } from 'src/app/common/models/domain/library/library-book.model';
import { BookSeriesModel } from 'src/app/common/models/domain/library/book-series.model';
import { LibraryFieldContext } from '@impact-common/formio/library-field.component';

/**
 * Ported from impact-discipleship-library-manager-new's
 * features/lesson-preview/lesson-preview.component.ts, including the
 * language switcher (originally cut when this screen was first ported -
 * restored now that the Translations screens are ported too).
 */
@Component({
  selector: 'app-lesson-preview',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatFormFieldModule, MatSelectModule],
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
  private readonly translationService = inject(LibraryTranslationService);
  private readonly titleTranslationService = inject(LibraryTitleTranslationService);
  private readonly commonTranslationService = inject(LibraryCommonTranslationService);

  lessonId!: string;
  lesson: LibraryLessonModel | undefined;
  unit: LibraryUnitModel | undefined;
  book: LibraryBookModel | undefined;
  bookSeries: BookSeriesModel | undefined;
  loading = true;
  loadError: string | null = null;

  translations: LessonTranslation[] = [];
  titleTranslations: TitleTranslation[] = [];
  commonTranslations: CommonTranslation[] = [];
  selectedTranslationId = '';
  renderingTranslation = false;

  get displayTitle(): string {
    const locale = this.translations.find((t) => t.id === this.selectedTranslationId)?.locale;
    const fallback = this.lesson?.title ?? 'Lesson';
    if (!locale) {
      return fallback;
    }
    return this.titleTranslations.find((t) => t.locale === locale)?.title || fallback;
  }

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
    this.selectedTranslationId = '';

    try {
      const [lesson, translations, commonTranslations] = await Promise.all([
        this.lessons.getById(id),
        this.translationService.getTranslations(id),
        this.commonTranslationService.getCommonTranslations(),
      ]);
      // Resolve `lessonimage:{id}` placeholders back to real data URIs once,
      // up front - both renderForm() calls below (original + translated)
      // reuse this same hydrated schema.
      const hydratedSchema = lesson ? await this.lessonImages.hydrateSchema(lesson.formSchema) : null;
      this.lesson = lesson ? { ...lesson, formSchema: hydratedSchema } : lesson;
      this.translations = translations;
      this.commonTranslations = commonTranslations;

      // Walk the ancestor chain so the "Library Field" component can offer
      // unit/book/series values too, not just the lesson's own fields.
      const unit = lesson ? await this.units.getById(lesson.unitId) : undefined;
      const book = unit ? await this.books.getById(unit.bookId) : undefined;
      const bookSeries = book ? await this.series.getById(book.seriesId) : undefined;
      this.unit = unit;
      this.book = book;
      this.bookSeries = bookSeries;

      const nodeIds = [id, unit?.id, book?.id, bookSeries?.id].filter((v): v is string => !!v);
      const titleTranslationLists = await Promise.all(
        nodeIds.map((nodeId) => this.titleTranslationService.getTitleTranslations(nodeId)),
      );
      this.titleTranslations = titleTranslationLists.flat();

      await this.renderForm(null);
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
      console.error('LessonPreviewComponent failed to load lesson', id, err);
    } finally {
      this.loading = false;
    }
  }

  async onTranslationChange(translationId: string): Promise<void> {
    this.selectedTranslationId = translationId;
    const translation = translationId ? (this.translations.find((t) => t.id === translationId) ?? null) : null;
    await this.renderForm(translation);
  }

  /** Resolves what a `libraryField` component should display for each
   *  source, for the given translation (or the original, if null) - see the
   *  source component's identical doc comment. */
  private buildLibraryContext(translation: LessonTranslation | null): LibraryFieldContext {
    const locale = translation?.locale;

    const titleFor = (nodeId: string | undefined, fallback: string | undefined): string | undefined => {
      if (!nodeId) {
        return fallback;
      }
      const translated = locale && this.titleTranslations.find((t) => t.nodeId === nodeId && t.locale === locale);
      return (translated && translated.title) || fallback;
    };

    return {
      lesson: this.lesson
        ? {
            title: titleFor(this.lesson.id, this.lesson.title),
            memoryVerse: translation?.memoryVerse || this.lesson.memoryVerse,
            dailyReadingVerse: translation?.dailyReadingVerse || this.lesson.dailyReadingVerse,
            goal: translation?.goal || this.lesson.goal,
            monVerse: translation?.monVerse || this.lesson.monVerse,
            tueVerse: translation?.tueVerse || this.lesson.tueVerse,
            wedVerse: translation?.wedVerse || this.lesson.wedVerse,
            thuVerse: translation?.thuVerse || this.lesson.thuVerse,
            friVerse: translation?.friVerse || this.lesson.friVerse,
          }
        : undefined,
      unit: this.unit ? { title: titleFor(this.unit.id, this.unit.title) } : undefined,
      book: this.book
        ? { title: titleFor(this.book.id, this.book.title), author: this.book.author, year: this.book.year }
        : undefined,
      series: this.bookSeries ? { title: titleFor(this.bookSeries.id, this.bookSeries.title) } : undefined,
    };
  }

  private async renderForm(translation: LessonTranslation | null): Promise<void> {
    const schema = this.lesson?.formSchema;
    if (!schema) {
      return;
    }

    this.renderingTranslation = true;
    this.form?.destroy?.();
    const libraryContext = this.buildLibraryContext(translation);

    if (!translation) {
      this.form = await Formio.createForm(this.formContainer.nativeElement, schema, {
        readOnly: true,
        libraryContext,
      });
      this.renderingTranslation = false;
      return;
    }

    // Build an i18next-style resource map (original text -> translated text)
    // from the *live* schema labels merged with the translation's saved
    // text, so the keys Form.io looks up match exactly what it's about to
    // render even if the translation predates a later label edit.
    const liveFields = extractTranslatableFields(schema);
    const savedByKey = new Map(translation.fields.map((f) => [f.key, f.translatedText]));
    const commonByText = new Map(
      this.commonTranslations.filter((c) => c.locale === translation.locale).map((c) => [c.originalText, c.translatedText]),
    );
    const resource: Record<string, string> = Object.fromEntries(commonByText);
    for (const field of liveFields) {
      const translatedText = commonByText.get(field.originalText) ?? savedByKey.get(field.key);
      if (translatedText?.trim()) {
        resource[field.originalText] = translatedText;
      }
    }
    const hydratedResource = await this.lessonImages.hydrateTranslationResource(resource);

    this.form = await Formio.createForm(this.formContainer.nativeElement, schema, {
      readOnly: true,
      libraryContext,
      language: translation.locale,
      i18n: {
        language: translation.locale,
        resources: { [translation.locale]: { translation: hydratedResource } },
      },
    });
    this.renderingTranslation = false;
  }
}
