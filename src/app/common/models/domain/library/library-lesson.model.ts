import { BaseModel } from '../../base.model';

export type LibraryLessonStatus = 'draft' | 'published';

/** Minimal shape of a Form.io form schema - components intentionally loose,
 *  matching the shared submodule's own FormioSchema/FormioComponent. Full
 *  rendering/editing of this arrives with Phase 2 Slice 2 (Content
 *  authoring); Slice 1 only ever reads `title`/`order` off a lesson. */
export interface LibraryFormioSchema {
  display?: string;
  components: LibraryFormioComponent[];
}

export interface LibraryFormioComponent {
  key: string;
  type: string;
  label?: string;
  [prop: string]: unknown;
}

// Mirrors impact-discipleship-library-manager-new's own Lesson shape - see
// book-series.model.ts's own comment on why this is a fresh model.
export class LibraryLessonModel extends BaseModel {
  unitId: string;
  bookId?: string;
  title: string;
  order: number;
  status: LibraryLessonStatus;
  formSchema: LibraryFormioSchema | null;
  showDailyReading?: boolean;
  dailyReadingVerse?: string;
  goal?: string;
  memoryVerse?: string;
  monVerse?: string;
  tueVerse?: string;
  wedVerse?: string;
  thuVerse?: string;
  friVerse?: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
  version?: string;
}
