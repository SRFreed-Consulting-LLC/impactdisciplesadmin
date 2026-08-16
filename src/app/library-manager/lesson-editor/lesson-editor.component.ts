import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Formio } from '@formio/js';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LibraryLessonService } from 'src/app/common/services/data/library/library-lesson.service';
import { LibraryUnitService } from 'src/app/common/services/data/library/library-unit.service';
import { LibraryBookService } from 'src/app/common/services/data/library/library-book.service';
import { BookSeriesService } from 'src/app/common/services/data/library/book-series.service';
import { LibraryLessonImageService } from 'src/app/common/services/data/library/library-lesson-image.service';
import { LibrarySubtemplateService } from 'src/app/common/services/data/library/library-subtemplate.service';
import { ensureLibraryFormioComponentsRegistered } from 'src/app/common/services/data/library/library-formio-registration.util';
import { ensureLibraryVendorStylesheet } from 'src/app/common/services/data/library/library-vendor-stylesheet.util';
import { mergeSubtemplateIntoSchema } from 'src/app/common/services/data/library/library-template-merge.util';
import { LibraryFormioSchema } from 'src/app/common/models/domain/library/library-lesson.model';
import { LibraryLessonModel } from 'src/app/common/models/domain/library/library-lesson.model';
import { LibraryUnitModel } from 'src/app/common/models/domain/library/library-unit.model';
import { LibraryBookModel } from 'src/app/common/models/domain/library/library-book.model';
import { BookSeriesModel } from 'src/app/common/models/domain/library/book-series.model';
import { LibrarySubtemplateModel } from 'src/app/common/models/domain/library/library-subtemplate.model';
import { DailyReadingDialogComponent } from './daily-reading-dialog.component';

const EMPTY_SCHEMA: LibraryFormioSchema = { display: 'form', components: [] };

interface PendingSubtemplateMerge {
  subtemplateTitle: string;
  placement: 'top' | 'bottom';
  previousSchema: LibraryFormioSchema;
}

/**
 * Ported from impact-discipleship-library-manager-new's
 * features/lesson-editor/lesson-editor.component.ts. Differences from the
 * source, all deliberate scope cuts for this slice, not omissions:
 * - Breadcrumb is plain text, not clickable - Browse (Slice 1) doesn't have
 *   per-series/book/unit routes yet, only its own internal drill-down state.
 *   Revisit once Browse gets real deep-linkable routes.
 * - No Help icon - this app has no in-app help system like the source app's.
 * - No Preview link / Create Translation link - Lesson Preview and
 *   Translations are later Slice 2 sub-steps, not built yet.
 * `readyForNextSteps` is kept (harmless, and those two links will read off
 * it once they exist).
 */
@Component({
  selector: 'app-lesson-editor',
  standalone: true,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './lesson-editor.component.html',
  styleUrl: './lesson-editor.component.scss',
})
export class LessonEditorComponent implements OnInit, OnDestroy {
  @ViewChild('builderContainer', { static: true }) builderContainer!: ElementRef<HTMLDivElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly lessons = inject(LibraryLessonService);
  private readonly units = inject(LibraryUnitService);
  private readonly books = inject(LibraryBookService);
  private readonly series = inject(BookSeriesService);
  private readonly lessonImages = inject(LibraryLessonImageService);
  private readonly subtemplateService = inject(LibrarySubtemplateService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  lessonId!: string;
  readonly lesson = signal<LibraryLessonModel | undefined>(undefined);
  // Ancestor chain for the breadcrumb - fetched alongside the lesson itself.
  readonly unit = signal<LibraryUnitModel | undefined>(undefined);
  readonly book = signal<LibraryBookModel | undefined>(undefined);
  readonly bookSeries = signal<BookSeriesModel | undefined>(undefined);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly readyForNextSteps = signal(false);
  readonly subtemplates = signal<LibrarySubtemplateModel[]>([]);
  // Layout subtemplates are only ever applied as part of a Lesson Template at
  // lesson-creation time (a later slice) - standalone application to an
  // existing lesson only makes sense for Header/Footer, which have an
  // unambiguous, automatic placement (top/bottom respectively).
  readonly templatableSubtemplates = computed(() =>
    this.subtemplates().filter((t) => t.type === 'header' || t.type === 'footer'),
  );
  readonly pendingMerge = signal<PendingSubtemplateMerge | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private builder: any;
  // The last saved (or just-loaded) schema, stringified, to diff the live
  // builder state against - see hasUnsavedChanges().
  private lastSavedSchema = '';

  constructor() {
    ensureLibraryFormioComponentsRegistered();
    ensureLibraryVendorStylesheet('bootstrap.min.css');
    ensureLibraryVendorStylesheet('formio.full.min.css');
  }

  ngOnInit(): void {
    // Angular reuses this component instance across navigations that match
    // the same route config - only the params change, so ngOnInit does not
    // fire again. Reacting to paramMap (which re-emits on every navigation)
    // instead of a one-shot route.snapshot read is what makes each lesson
    // actually load.
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (id) {
        void this.loadLesson(id);
      }
    });
  }

  private async loadLesson(id: string): Promise<void> {
    this.lessonId = id;
    this.loading.set(true);
    this.pendingMerge.set(null);

    const [lesson, subtemplates] = await Promise.all([
      this.lessons.getById(id),
      this.subtemplateService.getAll(),
    ]);
    this.lesson.set(lesson);
    this.subtemplates.set(subtemplates);
    this.readyForNextSteps.set(!!lesson?.formSchema);

    // Ancestor chain for the breadcrumb - each step depends on the previous
    // id, so these can't be kicked off in parallel with each other.
    const unit = lesson ? await this.units.getById(lesson.unitId) : undefined;
    const book = unit ? await this.books.getById(unit.bookId) : undefined;
    const bookSeries = book ? await this.series.getById(book.seriesId) : undefined;
    this.unit.set(unit);
    this.book.set(book);
    this.bookSeries.set(bookSeries);

    this.loading.set(false);

    // Resolve `lessonimage:{id}` placeholders back to real data URIs before
    // handing the schema to the builder, so the admin sees actual images
    // while editing rather than broken-image icons.
    const hydratedSchema =
      (await this.lessonImages.hydrateSchema(lesson?.formSchema ?? null)) ?? EMPTY_SCHEMA;

    this.builder?.instance?.destroy?.();
    this.builder = await Formio.builder(
      this.builderContainer.nativeElement,
      hydratedSchema,
      // noDefaultSubmitButton: Form.io's builder otherwise auto-appends a
      // default "Submit" button to any form/wizard that doesn't already have
      // one - not something a lesson (as opposed to a data-collecting form)
      // needs.
      { builder: { premium: false }, noDefaultSubmitButton: true },
    );
    this.lastSavedSchema = JSON.stringify(this.builder.schema);
  }

  ngOnDestroy(): void {
    this.builder?.instance?.destroy?.();
  }

  /** Whether the live builder state has drifted from what's actually saved. */
  hasUnsavedChanges(): boolean {
    return !!this.builder && JSON.stringify(this.builder.schema) !== this.lastSavedSchema;
  }

  // Router navigation is guarded by libraryUnsavedChangesGuard, which shows
  // our own Save/Discard/Cancel dialog. That guard can't help with a tab
  // close or hard refresh though - this is the only hook the browser gives
  // for that, and it only supports a generic native "leave site?" prompt.
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  subtemplateLabel(subtemplate: LibrarySubtemplateModel): string {
    return `${subtemplate.title} (${subtemplate.type === 'header' ? 'Header' : 'Footer'})`;
  }

  /** Merges a Header/Footer subtemplate into the lesson - placement follows
   *  directly from its type (Header -> top, Footer -> bottom), so there's
   *  nothing left to ask the user. */
  async addSubtemplate(subtemplate: LibrarySubtemplateModel): Promise<void> {
    if (!this.builder || this.pendingMerge()) {
      return;
    }
    const placement: 'top' | 'bottom' = subtemplate.type === 'header' ? 'top' : 'bottom';

    // Snapshot the live builder state (not the lesson's last-saved schema) so
    // Undo restores exactly what was there a moment ago, including any
    // unsaved edits the user made before adding this subtemplate.
    const previousSchema = this.builder.schema as LibraryFormioSchema;
    const mergedSchema = mergeSubtemplateIntoSchema(
      previousSchema,
      subtemplate.formSchema,
      placement,
    );

    await this.builder.setForm(mergedSchema);
    this.pendingMerge.set({ subtemplateTitle: subtemplate.title, placement, previousSchema });
  }

  keepMerge(): void {
    this.pendingMerge.set(null);
  }

  async undoMerge(): Promise<void> {
    const pending = this.pendingMerge();
    if (!pending || !this.builder) {
      return;
    }
    await this.builder.setForm(pending.previousSchema);
    this.pendingMerge.set(null);
  }

  async save(): Promise<void> {
    if (!this.builder || this.pendingMerge()) {
      return;
    }
    this.saving.set(true);
    try {
      const schema = this.builder.schema as LibraryFormioSchema;
      // Extract any newly-added embedded base64 images into their own
      // lessonImages documents before persisting - only the placeholder
      // reference ever gets written to the lesson doc itself.
      const dehydratedSchema = await this.lessonImages.dehydrateSchema(schema);
      const version = await this.lessons.saveLessonForm(
        this.lessonId,
        dehydratedSchema,
        this.lesson()?.title ?? '',
      );
      const lesson = this.lesson();
      if (lesson) {
        this.lesson.set({ ...lesson, formSchema: schema, status: 'published', version });
      }
      this.lastSavedSchema = JSON.stringify(schema);
      this.readyForNextSteps.set(true);
      this.snackBar.open('Lesson content saved.', 'Dismiss', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }

  openDailyReadingDialog(): void {
    const lesson = this.lesson();
    if (!lesson) {
      return;
    }
    const ref = this.dialog.open(DailyReadingDialogComponent, {
      width: '520px',
      data: {
        plan: {
          showDailyReading: lesson.showDailyReading,
          dailyReadingVerse: lesson.dailyReadingVerse,
          goal: lesson.goal,
          memoryVerse: lesson.memoryVerse,
          monVerse: lesson.monVerse,
          tueVerse: lesson.tueVerse,
          wedVerse: lesson.wedVerse,
          thuVerse: lesson.thuVerse,
          friVerse: lesson.friVerse,
        },
      },
    });
    ref.afterClosed().subscribe(async (plan) => {
      if (!plan) {
        return;
      }
      await this.lessons.saveDailyReadingPlan(this.lessonId, plan, lesson.title);
      this.lesson.set({ ...lesson, ...plan });
      this.snackBar.open('Daily reading plan saved.', 'Dismiss', { duration: 3000 });
    });
  }
}
