import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { LibraryLessonService } from 'src/app/common/services/data/library/library-lesson.service';
import {
  LibraryDailyReadingTranslation,
  LibraryTranslationService,
} from 'src/app/common/services/data/library/library-translation.service';
import { LibraryCommonTranslationService } from 'src/app/common/services/data/library/library-common-translation.service';
import { LibraryLessonImageService } from 'src/app/common/services/data/library/library-lesson-image.service';
import {
  LESSON_IMAGE_PLACEHOLDER_RE,
  extractImageSrc,
  extractTranslatableFields,
  replaceImageSrc,
} from '@impact-common/formio/form-translation.util';
import { TranslationField, LessonTranslation } from '@impact-common/models/translation.models';
import { LibraryLessonModel } from 'src/app/common/models/domain/library/library-lesson.model';
import { LocaleDialogComponent, LocaleDialogResult } from '../dialogs/locale-dialog.component';

interface DailyReadingRow {
  key: keyof LibraryDailyReadingTranslation;
  label: string;
  originalText: string;
  translatedText: string;
}

const DAILY_READING_FIELDS: { key: keyof LibraryDailyReadingTranslation; label: string }[] = [
  { key: 'memoryVerse', label: 'Memory Verse' },
  { key: 'goal', label: 'Goal' },
  { key: 'dailyReadingVerse', label: 'Daily Reading Verse' },
  { key: 'monVerse', label: 'Monday' },
  { key: 'tueVerse', label: 'Tuesday' },
  { key: 'wedVerse', label: 'Wednesday' },
  { key: 'thuVerse', label: 'Thursday' },
  { key: 'friVerse', label: 'Friday' },
];

/**
 * Ported from impact-discipleship-library-manager-new's
 * features/lesson-translation/lesson-translation.component.ts. Differences,
 * all deliberate scope cuts:
 * - No Help icon - this app has no in-app help system.
 * - The "Shared across lessons - edit centrally" link to /common-translations
 *   is plain text, not a link - that management screen isn't ported yet
 *   (LibraryCommonTranslationService.findCommonPhrases() is ready for it,
 *   see that service's own doc comment).
 */
// Deliberately NOT on <app-data-grid>, unlike the list screens folded onto
// it in 2026-08's Library Manager pass (bucket A item #1). The two <table>
// elements here are side-by-side TRANSLATION EDITORS - source text in one
// column, an editable textarea for the target language in the next - not
// lists of records. The grid renders read-only cells with a filter row,
// columns picker and export, none of which belong on a form, and every
// editable cell would need its own template to reproduce. The shared grid is
// for list screens; this is a form laid out in a table.
@Component({
  selector: 'app-lesson-translation',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './lesson-translation.component.html',
  styleUrl: './lesson-translation.component.scss',
})
export class LessonTranslationComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly lessons = inject(LibraryLessonService);
  private readonly translations = inject(LibraryTranslationService);
  private readonly commonTranslations = inject(LibraryCommonTranslationService);
  private readonly lessonImages = inject(LibraryLessonImageService);
  private readonly dialog = inject(MatDialog);
  private readonly confirmService = inject(ConfirmService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  lessonId!: string;
  translationId: string | null = null;
  readonly mode = signal<'list' | 'edit'>('list');

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly lesson = signal<LibraryLessonModel | undefined>(undefined);

  readonly translationList = signal<LessonTranslation[]>([]);

  readonly editingTranslation = signal<LessonTranslation | undefined>(undefined);
  readonly fields = signal<TranslationField[]>([]);
  readonly commonPhraseTexts = signal<Set<string>>(new Set());
  readonly dailyReadingRows = signal<DailyReadingRow[]>([]);
  readonly imageDataById = signal<Map<string, string>>(new Map());

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (!id) {
        return;
      }
      this.lessonId = id;
      this.translationId = params.get('translationId');
      this.mode.set(this.translationId ? 'edit' : 'list');
      void this.load();
    });
  }

  backToEditor(): void {
    void this.router.navigate(['/library-manager/lessons', this.lessonId]);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.editingTranslation.set(undefined);
    this.fields.set([]);
    this.dailyReadingRows.set([]);
    const lesson = await this.lessons.getById(this.lessonId);
    this.lesson.set(lesson);

    if (this.mode() === 'list') {
      const list = await this.translations.getTranslations(this.lessonId);
      this.translationList.set(list);
    } else if (this.translationId) {
      const translation = await this.translations.getTranslation(this.lessonId, this.translationId);
      this.editingTranslation.set(translation);

      const liveFields = extractTranslatableFields(lesson?.formSchema ?? null);
      const savedByKey = new Map((translation?.fields ?? []).map((f) => [f.key, f.translatedText]));

      const allCommon = await this.commonTranslations.getCommonTranslations();
      this.commonPhraseTexts.set(new Set(allCommon.map((c) => c.originalText)));
      const commonForLocale = new Map(
        allCommon.filter((c) => c.locale === translation?.locale).map((c) => [c.originalText, c.translatedText]),
      );

      this.fields.set(
        liveFields.map((field) => {
          if (commonForLocale.has(field.originalText)) {
            return { ...field, translatedText: commonForLocale.get(field.originalText) ?? '' };
          }
          const saved = savedByKey.get(field.key) ?? '';
          const isImage = field.kind === 'html' && extractImageSrc(field.originalText) !== null;
          return { ...field, translatedText: isImage ? saved || field.originalText : saved };
        }),
      );
      await this.hydrateImages();

      if (lesson?.showDailyReading) {
        this.dailyReadingRows.set(
          DAILY_READING_FIELDS.filter((f) => (lesson[f.key] ?? '').trim()).map((f) => ({
            key: f.key,
            label: f.label,
            originalText: lesson[f.key] ?? '',
            translatedText: translation?.[f.key] ?? '',
          })),
        );
      }
    }
    this.loading.set(false);
  }

  async createTranslation(): Promise<void> {
    const ref = this.dialog.open(LocaleDialogComponent, {
      width: '400px',
      data: { excludeLocales: this.translationList().map((t) => t.locale) },
    });
    const result: LocaleDialogResult | undefined = await firstValueFrom(ref.afterClosed());
    if (!result) {
      return;
    }

    const fields = extractTranslatableFields(this.lesson()?.formSchema ?? null);
    const translationId = await this.translations.createTranslation(
      this.lessonId,
      result.code,
      result.label,
      fields,
      this.lesson()?.title ?? '',
    );
    void this.router.navigate(['/library-manager/lessons', this.lessonId, 'translate', translationId]);
  }

  openTranslation(translation: LessonTranslation): void {
    void this.router.navigate(['/library-manager/lessons', this.lessonId, 'translate', translation.id]);
  }

  isCommonPhrase(field: TranslationField): boolean {
    return this.commonPhraseTexts().has(field.originalText);
  }

  updateFieldText(index: number, value: string): void {
    const updated = [...this.fields()];
    updated[index] = { ...updated[index], translatedText: value };
    this.fields.set(updated);
  }

  updateDailyReadingField(index: number, value: string): void {
    const updated = [...this.dailyReadingRows()];
    updated[index] = { ...updated[index], translatedText: value };
    this.dailyReadingRows.set(updated);
  }

  private async hydrateImages(): Promise<void> {
    const ids = new Set<string>();
    for (const field of this.fields()) {
      if (field.kind !== 'html') {
        continue;
      }
      for (const match of field.originalText.matchAll(LESSON_IMAGE_PLACEHOLDER_RE)) {
        ids.add(match[1]);
      }
      for (const match of field.translatedText.matchAll(LESSON_IMAGE_PLACEHOLDER_RE)) {
        ids.add(match[1]);
      }
    }
    if (ids.size === 0) {
      this.imageDataById.set(new Map());
      return;
    }
    const map = new Map<string, string>();
    await Promise.all(
      [...ids].map(async (id) => {
        const dataUri = await this.lessonImages.getImageDataUri(id);
        if (dataUri) {
          map.set(id, dataUri);
        }
      }),
    );
    this.imageDataById.set(map);
  }

  imageSrcFor(field: TranslationField): string | null {
    const placeholder = field.kind === 'html' ? extractImageSrc(field.originalText) : null;
    return placeholder ? (this.imageDataById().get(placeholder.slice('lessonimage:'.length)) ?? null) : null;
  }

  translatedImageSrc(field: TranslationField, fallback: string): string {
    const placeholder = extractImageSrc(field.translatedText);
    if (!placeholder) {
      return fallback;
    }
    return this.imageDataById().get(placeholder.slice('lessonimage:'.length)) ?? fallback;
  }

  async onImageSelected(index: number, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    const dataUrl = await this.readFileAsDataUrl(file);
    const imageId = await this.lessonImages.uploadImage(dataUrl);
    const updatedHtml = replaceImageSrc(this.fields()[index].originalText, `lessonimage:${imageId}`);
    this.updateFieldText(index, updatedHtml);
    const map = new Map(this.imageDataById());
    map.set(imageId, dataUrl);
    this.imageDataById.set(map);
    input.value = '';
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async saveTranslation(): Promise<void> {
    if (!this.translationId) {
      return;
    }
    this.saving.set(true);
    try {
      const dailyReading = Object.fromEntries(
        this.dailyReadingRows().map((row) => [row.key, row.translatedText]),
      ) as LibraryDailyReadingTranslation;
      await this.translations.updateTranslationFields(
        this.lessonId,
        this.translationId,
        this.fields(),
        dailyReading,
        this.editingTranslation()?.localeLabel ?? '',
        this.lesson()?.title ?? '',
      );
      this.snackBar.open('Translation saved.', 'Dismiss', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }

  async deleteTranslation(translation: LessonTranslation, event: Event): Promise<void> {
    event.stopPropagation();
    event.preventDefault();
    const confirmed = await this.confirmService.confirm(
      `Delete the ${translation.localeLabel} translation?`,
      'Delete translation',
    );
    if (!confirmed) {
      return;
    }
    await this.translations.deleteTranslation(
      this.lessonId,
      translation.id,
      translation.localeLabel,
      this.lesson()?.title ?? '',
    );
    this.translationList.set(this.translationList().filter((t) => t.id !== translation.id));
  }
}
