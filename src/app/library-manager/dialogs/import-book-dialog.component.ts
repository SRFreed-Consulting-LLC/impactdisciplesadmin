import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BookSeriesService } from 'src/app/common/services/data/library/book-series.service';
import { LibraryImportBookService } from 'src/app/common/services/data/library/library-import-book.service';
import { BookSeriesModel } from 'src/app/common/models/domain/library/book-series.model';
import { LibraryBookPlan, LibraryImportBookRequest } from 'src/app/common/models/domain/library/library-book-import.model';

// Sentinel for the "Create a new series" option - mat-select treats a bound
// null as "nothing selected", so an empty-string sentinel is used and
// mapped back to null (a new series) on submit.
const NEW_SERIES = '__new__';

type Step = 'form' | 'preview' | 'running' | 'done';

/**
 * Ported from impact-discipleship-library-manager-new's
 * features/shell/dialogs/import-book-dialog.component.ts.
 */
@Component({
  selector: 'app-import-book-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatProgressBarModule,
    MatDividerModule,
    MatTooltipModule,
  ],
  templateUrl: './import-book-dialog.component.html',
  styleUrl: './import-book-dialog.component.scss',
})
export class ImportBookDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<ImportBookDialogComponent>);
  private readonly seriesService = inject(BookSeriesService);
  private readonly importService = inject(LibraryImportBookService);

  readonly NEW_SERIES = NEW_SERIES;
  readonly step = signal<Step>('form');
  readonly seriesList = signal<BookSeriesModel[]>([]);
  readonly plan = signal<LibraryBookPlan | null>(null);
  readonly error = signal<string | null>(null);
  readonly file = signal<File | null>(null);
  readonly progress = this.importService.progress;

  private storagePath: string | null = null;

  readonly form = this.fb.nonNullable.group({
    seriesId: [NEW_SERIES, Validators.required],
    newSeriesTitle: [''],
    newSeriesDescription: [''],
    code: ['', [Validators.required, Validators.minLength(2)]],
    order: [1, [Validators.required, Validators.min(0)]],
  });

  constructor() {
    this.seriesService.getAll().then((list) => this.seriesList.set(list));
  }

  get creatingNewSeries(): boolean {
    return this.form.controls.seriesId.value === NEW_SERIES;
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const chosen = input.files?.[0] ?? null;
    if (chosen && chosen.type !== 'application/pdf' && !chosen.name.toLowerCase().endsWith('.pdf')) {
      this.error.set('Please choose a PDF file.');
      this.file.set(null);
      return;
    }
    this.error.set(null);
    this.file.set(chosen);
  }

  totalLessons(plan: LibraryBookPlan): number {
    return plan.units.reduce((n, u) => n + u.lessons.length, 0);
  }

  interactiveLessons(plan: LibraryBookPlan): number {
    return plan.units.reduce((n, u) => n + u.lessons.filter((l) => l.hasQuestions).length, 0);
  }

  imageLessons(plan: LibraryBookPlan): number {
    return plan.units.reduce((n, u) => n + u.lessons.filter((l) => l.imageCount > 0).length, 0);
  }

  private buildRequest(): LibraryImportBookRequest {
    const raw = this.form.getRawValue();
    return {
      series: this.creatingNewSeries
        ? {
            seriesId: null,
            newSeriesTitle: raw.newSeriesTitle.trim(),
            newSeriesDescription: raw.newSeriesDescription.trim(),
          }
        : { seriesId: raw.seriesId },
      code: raw.code.trim(),
      order: raw.order,
      file: this.file()!,
    };
  }

  /** Step 1 -> 2: upload + plan. */
  async analyze(): Promise<void> {
    this.error.set(null);
    if (this.creatingNewSeries && !this.form.controls.newSeriesTitle.value.trim()) {
      this.error.set('Enter a title for the new series.');
      return;
    }
    if (!this.file()) {
      this.error.set('Choose a PDF to import.');
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.step.set('running');
    try {
      const { plan, storagePath } = await this.importService.uploadAndPlan(this.buildRequest());
      this.plan.set(plan);
      this.storagePath = storagePath;
      this.step.set('preview');
    } catch (err) {
      this.failTo('form', err);
    }
  }

  /** Step 2 -> 3 -> 4: generate + write. */
  async runImport(): Promise<void> {
    const plan = this.plan();
    if (!plan || !this.storagePath) {
      return;
    }
    this.error.set(null);
    this.step.set('running');
    try {
      await this.importService.generateAndWrite(this.buildRequest(), plan, this.storagePath);
      this.step.set('done');
    } catch (err) {
      this.failTo('preview', err);
    }
  }

  private failTo(step: Step, err: unknown): void {
    this.error.set(err instanceof Error ? err.message : 'Something went wrong.');
    this.step.set(step);
  }

  backToForm(): void {
    if (this.storagePath) {
      void this.importService.cleanup(this.storagePath);
      this.storagePath = null;
    }
    this.plan.set(null);
    this.step.set('form');
  }

  close(): void {
    this.importService.reset();
    this.dialogRef.close(this.step() === 'done');
  }

  cancel(): void {
    if (this.storagePath && this.step() !== 'done') {
      void this.importService.cleanup(this.storagePath);
    }
    this.importService.reset();
    this.dialogRef.close(false);
  }
}
