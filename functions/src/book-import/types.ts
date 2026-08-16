// Ported verbatim from impact-discipleship-library-manager-new's
// functions/src/book-import/types.ts. The intermediate "block model" the AI
// import pipeline speaks in. The Cloud Function asks Claude to describe a
// book as this compact, well-defined shape (structure + typed content
// blocks) rather than emitting raw Form.io JSON - the exact Form.io
// component templates are reconstructed deterministically on the client
// (see book-schema-assembler.util.ts), so fidelity lives in code we
// control, not in fragile model output. Keep this file in sync with the
// client's mirror.

/** A single piece of lesson content. `section` places it on the Lesson tab
 *  (default) or the Discussion tab; the assembler only builds a tabbed
 *  layout when at least one 'discussion' block is present. */
export type ImportBlock =
  | { kind: "heading"; text: string; section?: BlockSection }
  | { kind: "content"; html: string; section?: BlockSection }
  | {
      kind: "question";
      /** The question/prompt shown above the answer field. */
      prompt: string;
      /** Free-text answers use a textarea; short answers a single-line
       *  field. */
      inputType: "textarea" | "textfield";
      section?: BlockSection;
    }
  | {
      kind: "image";
      /** 1-based PDF page the image appears on, so a later raster-extraction
       *  pass (or the admin) can find it. */
      page: number;
      alt?: string;
      caption?: string;
      section?: BlockSection;
    };

export type BlockSection = "lesson" | "discussion";

/** A weekday devotional reading plan, mapped 1:1 onto the Lesson doc's own
 *  optional daily-reading fields. Present only when the source lesson has
 *  one. */
export interface ImportDailyReading {
  goal?: string;
  memoryVerse?: string;
  monVerse?: string;
  tueVerse?: string;
  wedVerse?: string;
  thuVerse?: string;
  friVerse?: string;
}

/** One lesson as seen in the PLAN phase - just enough to show the admin a
 *  preview tree and decide before any content is generated or written. */
export interface PlannedLesson {
  title: string;
  /** Whether the lesson contains answerable questions - drives whether the
   *  generated schema gets answer fields + a Save/submit button at all. */
  hasQuestions: boolean;
  /** Best-effort count of images/diagrams in the lesson (surfaced so the
   *  admin knows how much manual image work to expect). */
  imageCount: number;
  /** Whether the lesson has a weekday devotional reading plan. */
  hasDailyReading: boolean;
  /** 1-based inclusive page range in the source PDF, used as a focus hint
   *  when generating this lesson's full content. */
  pageStart?: number;
  pageEnd?: number;
}

export interface PlannedUnit {
  title: string;
  lessons: PlannedLesson[];
}

/** The whole book as the PLAN phase sees it. */
export interface BookPlan {
  book: {
    title: string;
    description?: string;
    author?: string;
    year?: string;
  };
  units: PlannedUnit[];
}

/** The full content of a single lesson, produced in the LESSON phase. */
export interface LessonContent {
  blocks: ImportBlock[];
  dailyReading?: ImportDailyReading;
}

/** Request payload for the importBookFromPdf callable. `mode` selects the
 *  phase; the client drives the two-phase flow. */
export interface BookImportRequest {
  mode: "plan" | "lesson";
  /** Cloud Storage object path the client uploaded the PDF to (e.g.
   *  `book-imports/{uid}/{ts}.pdf`). Read server-side via the Admin SDK. */
  storagePath: string;
  /** LESSON mode only: which lesson to generate, plus the plan for context. */
  plan?: BookPlan;
  unitIndex?: number;
  lessonIndex?: number;
}
