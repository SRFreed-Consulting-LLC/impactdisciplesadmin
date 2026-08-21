import { Injectable, signal } from '@angular/core';
import { DocumentReference, Firestore, doc, getDoc, setDoc, updateDoc } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Storage, deleteObject, ref, uploadBytes } from '@angular/fire/storage';
import { firstValueFrom } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { LibraryActivityLogService } from './library-activity-log.service';
import { LibraryLessonImageService } from './library-lesson-image.service';
import { LibraryBookService } from './library-book.service';
import { LibraryUnitService } from './library-unit.service';
import { LibraryLessonService } from './library-lesson.service';
import { assembleLibraryLessonSchema } from './library-book-schema-assembler.util';
import { LibraryFormioSchema } from 'src/app/common/models/domain/library/library-lesson.model';
import {
  LibraryBookPlan,
  LibraryImportBookRequest,
  LibraryImportDailyReading,
  LibraryImportProgress,
  LibraryLessonContent,
} from 'src/app/common/models/domain/library/library-book-import.model';
import { CALLABLE_FUNCTIONS } from '@impact-common/shared/contract/functions-contract';

/** Stamped on every doc this importer writes. A guarded upsert refuses to
 *  touch a doc that exists WITHOUT this exact stamp, so a re-import can
 *  never clobber a hand-authored series/book/unit/lesson - it only updates
 *  its own output. */
const IMPORT_SOURCE_PREFIX = 'ai-book-import';

interface LibraryImportResult {
  seriesId: string;
  bookId: string;
  flagged: string[];
}

interface LibraryPlanResult {
  plan: LibraryBookPlan;
  storagePath: string;
}

/**
 * Orchestrates the AI book import end to end on the client - ported from
 * impact-discipleship-library-manager-new's ImportBookService. Same four
 * steps: upload the PDF, call importBookFromPdf for the plan, confirm and
 * generate+write each lesson, clean up. The Cloud Function only parses; all
 * Firestore writes happen here, gated by the same rules any staff content
 * write is (Editor/Admin/Root).
 */
@Injectable({
  providedIn: 'root'
})
export class LibraryImportBookService {
  private readonly _progress = signal<LibraryImportProgress | null>(null);
  readonly progress = this._progress.asReadonly();

  constructor(
    private firestore: Firestore,
    private functions: Functions,
    private storage: Storage,
    private authService: AdminAuthService,
    private activityLog: LibraryActivityLogService,
    private lessonImages: LibraryLessonImageService,
    private bookService: LibraryBookService,
    private unitService: LibraryUnitService,
    private lessonService: LibraryLessonService
  ) {}

  private async uid(): Promise<string> {
    const user = await firstValueFrom(this.authService.dao.loggedInUser$);
    return user?.firebaseUID ?? user?.id ?? '';
  }

  /** Phase 1: upload the PDF and get the structure plan to show the admin. */
  async uploadAndPlan(request: LibraryImportBookRequest): Promise<LibraryPlanResult> {
    const uid = await this.uid();
    this.setProgress('uploading', 'Uploading PDF…', 0, 0);
    const storagePath = `book-imports/${uid}/${Date.now()}-${sanitizeName(request.file.name)}`;
    await uploadBytes(ref(this.storage, storagePath), request.file, {
      contentType: 'application/pdf',
    });

    this.setProgress('planning', 'Reading the book and detecting its structure…', 0, 0);
    const plan = await this.call<LibraryBookPlan>({ mode: 'plan', storagePath });
    const lessonsTotal = plan.units.reduce((n, u) => n + u.lessons.length, 0);
    this.setProgress('planning', 'Structure detected. Review the plan to continue.', 0, lessonsTotal);
    return { plan, storagePath };
  }

  /** Phase 2: generate every lesson's content and write the library docs.
   *  Always invalidates LibraryBookService/LibraryUnitService/
   *  LibraryLessonService's memoized id -> ref maps afterwards - in a
   *  finally, since even a mid-run failure may already have created docs -
   *  so those services' next lookup re-scans and can resolve the newly
   *  created series/book/units/lessons (this is the ONLY code path in the
   *  app that creates docs in the librarySeries tree). */
  async generateAndWrite(
    request: LibraryImportBookRequest,
    plan: LibraryBookPlan,
    storagePath: string,
  ): Promise<LibraryImportResult> {
    try {
      return await this.doGenerateAndWrite(request, plan, storagePath);
    } finally {
      this.bookService.invalidateRefs();
      this.unitService.invalidateRefs();
      this.lessonService.invalidateRefs();
    }
  }

  private async doGenerateAndWrite(
    request: LibraryImportBookRequest,
    plan: LibraryBookPlan,
    storagePath: string,
  ): Promise<LibraryImportResult> {
    const code = normalizeCode(request.code);
    const stamp = `${IMPORT_SOURCE_PREFIX}:${code}`;
    const lessonsTotal = plan.units.reduce((n, u) => n + u.lessons.length, 0);
    const flagged: string[] = [];

    this.setProgress('writing', 'Creating series and book…', 0, lessonsTotal);
    const seriesId = await this.ensureSeries(request, code, stamp);
    const bookId = `${code}-book`;
    const bookRef = doc(this.firestore, 'librarySeries', seriesId, 'books', bookId);
    await this.guardedWrite(bookRef, stamp, {
      title: plan.book.title,
      description: plan.book.description ?? '',
      ...(plan.book.author ? { author: plan.book.author } : {}),
      ...(plan.book.year ? { year: plan.book.year } : {}),
      published: false,
      order: request.order,
    });

    let globalLessonIndex = 0;
    let lessonsDone = 0;
    for (let u = 0; u < plan.units.length; u++) {
      const unit = plan.units[u];
      const unitId = `${code}-u${u}`;
      const unitRef = doc(bookRef, 'units', unitId);
      await this.guardedWrite(unitRef, stamp, {
        title: unit.title,
        order: u,
      });

      for (let l = 0; l < unit.lessons.length; l++) {
        const planned = unit.lessons[l];
        this.setProgress(
          'generating',
          `Generating lesson ${lessonsDone + 1} of ${lessonsTotal}: "${planned.title}"…`,
          lessonsDone,
          lessonsTotal,
          flagged,
        );
        const content = await this.call<LibraryLessonContent>({
          mode: 'lesson',
          storagePath,
          plan,
          unitIndex: u,
          lessonIndex: l,
        });

        const { schema, imagePlaceholderCount } = assembleLibraryLessonSchema(content);
        const dehydrated = await this.lessonImages.dehydrateSchema(schema);

        const lessonId = `${code}-u${u}-l${globalLessonIndex}`;
        const lessonRef = doc(unitRef, 'lessons', lessonId);
        await this.guardedWrite(lessonRef, stamp, {
          title: planned.title,
          order: globalLessonIndex,
          status: 'draft',
          formSchema: dehydrated as LibraryFormioSchema,
          version: dateVersion(),
          ...dailyReadingFields(content.dailyReading),
        });

        if (imagePlaceholderCount > 0) {
          flagged.push(`${planned.title} (${imagePlaceholderCount} image${imagePlaceholderCount === 1 ? '' : 's'})`);
        }
        globalLessonIndex++;
        lessonsDone++;
      }
    }

    await this.activityLog.log('node_created', {
      targetName: plan.book.title,
      detail: `Imported Book (${lessonsTotal} lessons from PDF)`,
    });

    this.setProgress('done', 'Import complete.', lessonsDone, lessonsTotal, flagged);
    await this.cleanup(storagePath);
    return { seriesId, bookId, flagged };
  }

  /** Best-effort removal of the temporary uploaded PDF. */
  async cleanup(storagePath: string): Promise<void> {
    try {
      await deleteObject(ref(this.storage, storagePath));
    } catch {
      // A leftover temp PDF is harmless; never fail the import over cleanup.
    }
  }

  reset(): void {
    this._progress.set(null);
  }

  // ---- internals ---------------------------------------------------------

  private async ensureSeries(request: LibraryImportBookRequest, code: string, stamp: string): Promise<string> {
    if (request.series.seriesId) {
      return request.series.seriesId;
    }
    const seriesId = `${code}-series`;
    const seriesRef = doc(this.firestore, 'librarySeries', seriesId);
    await this.guardedWrite(seriesRef, stamp, {
      title: request.series.newSeriesTitle ?? plannedSeriesFallback(request),
      description: request.series.newSeriesDescription ?? '',
      order: Date.now(),
    });
    return seriesId;
  }

  /** Upsert that never overwrites a doc it didn't create. Preserves
   *  createdAt/createdBy on re-run; always bumps updatedAt/updatedBy. Takes
   *  a full doc reference (not a collection name + id) since Phase 3's
   *  nested schema means every doc but series lives at a different depth -
   *  callers build the ref themselves, walking down from the parent ref
   *  they already have in hand (series -> book -> unit -> lesson), and no
   *  longer stamp a seriesId/bookId/unitId field on the written data since
   *  those are hydrated from the doc's own path at read time instead. */
  private async guardedWrite(
    ref: DocumentReference,
    stamp: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const snap = await getDoc(ref);
    const now = Date.now();
    const uid = await this.uid();
    if (snap.exists()) {
      const existing = snap.data();
      if (existing['importSource'] !== stamp) {
        throw new Error(
          `${ref.path} already exists and was not created by this importer — aborting to avoid overwriting existing content.`,
        );
      }
      await updateDoc(ref, { ...data, updatedAt: now, updatedBy: uid });
      return;
    }
    await setDoc(ref, {
      ...data,
      importSource: stamp,
      createdAt: now,
      updatedAt: now,
      createdBy: uid,
      updatedBy: uid,
    });
  }

  private async call<T>(data: Record<string, unknown>): Promise<T> {
    // The default callable client timeout is 70s, but Claude reading a whole
    // PDF (plan) or transcribing a lesson can take longer - match the Cloud
    // Function's own 540s timeout so the client doesn't give up first.
    const callable = httpsCallable<Record<string, unknown>, T>(this.functions, CALLABLE_FUNCTIONS.importBookFromPdf, {
      timeout: 540_000,
    });
    const result = await callable(data);
    return result.data;
  }

  private setProgress(
    phase: LibraryImportProgress['phase'],
    message: string,
    lessonsDone: number,
    lessonsTotal: number,
    flagged: string[] = [],
  ): void {
    this._progress.set({ phase, message, lessonsDone, lessonsTotal, flagged });
  }
}

function dailyReadingFields(reading: LibraryImportDailyReading | undefined): Record<string, unknown> {
  if (!reading) {
    return {};
  }
  const fields: Record<string, unknown> = { showDailyReading: true };
  for (const key of ['goal', 'memoryVerse', 'monVerse', 'tueVerse', 'wedVerse', 'thuVerse', 'friVerse'] as const) {
    const value = reading[key];
    if (value) {
      fields[key] = value;
    }
  }
  return fields;
}

function dateVersion(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}.${m}.${d}.1`;
}

/** Lowercase, alphanumerics + dashes only - used for deterministic ids. */
function normalizeCode(code: string): string {
  const cleaned = code
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'book';
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function plannedSeriesFallback(request: LibraryImportBookRequest): string {
  return request.series.newSeriesTitle?.trim() || 'New Series';
}
