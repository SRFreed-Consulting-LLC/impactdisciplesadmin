// The AI book-import "block model" the importBookFromPdf Cloud Function
// speaks now lives ONCE in the shared submodule
// (@impact-common/shared/contract/book-import.types - Stage 2e-ii, 2026-08-20);
// functions/src/book-import/types.ts re-exports the same file, so the two
// sides can no longer drift. The Library* names below are kept as aliases
// so existing imports in this app keep working. The function parses a PDF
// into these shapes; this client assembles them into Form.io schemas
// (library-book-schema-assembler.util.ts) and writes the library content.
import type {
  BlockSection,
  BookPlan,
  ImportBlock,
  ImportDailyReading,
  LessonContent,
  PlannedLesson,
  PlannedUnit,
} from '@impact-common/shared/contract/book-import.types';

export type { BookImportRequest, BookImportResponse } from '@impact-common/shared/contract/book-import.types';

export type LibraryBlockSection = BlockSection;
export type LibraryImportBlock = ImportBlock;
export type LibraryImportDailyReading = ImportDailyReading;
export type LibraryPlannedLesson = PlannedLesson;
export type LibraryPlannedUnit = PlannedUnit;
export type LibraryBookPlan = BookPlan;
export type LibraryLessonContent = LessonContent;

// ---- Client-only shapes (the import dialog's own state) ----

/** Whether a new book is added to an existing series or a brand-new one. */
export interface LibrarySeriesChoice {
  /** Existing series id, or null to create a new series. */
  seriesId: string | null;
  newSeriesTitle?: string;
  newSeriesDescription?: string;
}

/** Everything the import dialog collects before the plan step. */
export interface LibraryImportBookRequest {
  series: LibrarySeriesChoice;
  /** Short lowercase book code used for deterministic ids, e.g. "dmc". */
  code: string;
  order: number;
  file: File;
}

/** Live progress the dialog renders while the import runs. */
export interface LibraryImportProgress {
  phase: 'uploading' | 'planning' | 'generating' | 'writing' | 'done' | 'error';
  message: string;
  lessonsDone: number;
  lessonsTotal: number;
  /** Lessons that imported but need manual attention (e.g. images to add). */
  flagged: string[];
  error?: string;
}
