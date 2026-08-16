// Client mirror of the AI book-import "block model" the importBookFromPdf
// Cloud Function speaks (functions/src/book-import/types.ts). Keep the two
// in sync. Ported from impact-discipleship-library-manager-new's
// core/models/book-import.models.ts. The function parses a PDF into these
// shapes; the client assembles them into Form.io schemas
// (library-book-schema-assembler.util.ts) and writes the library content,
// so the exact component templates live on this side, in code.

export type LibraryBlockSection = 'lesson' | 'discussion';

export type LibraryImportBlock =
  | { kind: 'heading'; text: string; section?: LibraryBlockSection }
  | { kind: 'content'; html: string; section?: LibraryBlockSection }
  | {
      kind: 'question';
      prompt: string;
      inputType: 'textarea' | 'textfield';
      section?: LibraryBlockSection;
    }
  | { kind: 'image'; page: number; alt?: string; caption?: string; section?: LibraryBlockSection };

export interface LibraryImportDailyReading {
  goal?: string;
  memoryVerse?: string;
  monVerse?: string;
  tueVerse?: string;
  wedVerse?: string;
  thuVerse?: string;
  friVerse?: string;
}

export interface LibraryPlannedLesson {
  title: string;
  hasQuestions: boolean;
  imageCount: number;
  hasDailyReading: boolean;
  pageStart?: number;
  pageEnd?: number;
}

export interface LibraryPlannedUnit {
  title: string;
  lessons: LibraryPlannedLesson[];
}

export interface LibraryBookPlan {
  book: {
    title: string;
    description?: string;
    author?: string;
    year?: string;
  };
  units: LibraryPlannedUnit[];
}

export interface LibraryLessonContent {
  blocks: LibraryImportBlock[];
  dailyReading?: LibraryImportDailyReading;
}

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
