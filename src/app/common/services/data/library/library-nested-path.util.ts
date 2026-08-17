import { DocumentReference } from '@angular/fire/firestore';

// Phase 3: the content hierarchy now lives as nested subcollections in this
// app's own default database -
//   librarySeries/{seriesId}
//     /books/{bookId}
//       /units/{unitId}
//         /lessons/{lessonId}
//           /translations/{translationId}
// - replacing the old flat collections + parent-id-reference fields
// (seriesId/bookId/unitId), which the Phase 3 migration scripts
// deliberately dropped on write: the nesting path IS the parent reference
// now, so nothing should be storing it redundantly as a field too.
//
// BUT every screen ported in Phase 2 (Lesson Editor's breadcrumb walk-up,
// the AI Book Import writer, etc.) was written against the OLD flat models,
// which DO carry `unitId`/`bookId`/`seriesId` fields - rewriting every one
// of those call sites to thread a full ancestor-id chain through instead
// would be a much bigger, riskier change than necessary. Compromise: the
// TS model interfaces keep their unitId/bookId/seriesId fields, and the
// service layer HYDRATES them from the doc's own Firestore path at read
// time (see parseLessonPath/parseUnitPath/parseBookPath below) rather than
// from stored data - Firestore stays clean (no redundant fields), every
// existing component keeps reading `lesson.unitId` etc. unchanged. Any
// write path must still drop these fields before writing (see each
// service's own write methods) - only ever populate them on the way OUT.

export interface SeriesPathIds {
  seriesId: string;
}

export interface BookPathIds extends SeriesPathIds {
  bookId: string;
}

export interface UnitPathIds extends BookPathIds {
  unitId: string;
}

export interface LessonPathIds extends UnitPathIds {
  lessonId: string;
}

/** Splits a book doc's full path (`librarySeries/{s}/books/{b}`) into its
 *  ancestor ids. Works from any DocumentReference at that depth, however it
 *  was obtained (a direct doc() lookup or a collectionGroup query result's
 *  own .ref). */
export function parseBookPath(ref: DocumentReference): BookPathIds {
  const parts = ref.path.split('/');
  return { seriesId: parts[1], bookId: parts[3] };
}

/** Splits a unit doc's full path
 *  (`librarySeries/{s}/books/{b}/units/{u}`) into its ancestor ids. */
export function parseUnitPath(ref: DocumentReference): UnitPathIds {
  const parts = ref.path.split('/');
  return { seriesId: parts[1], bookId: parts[3], unitId: parts[5] };
}

/** Splits a lesson doc's full path
 *  (`librarySeries/{s}/books/{b}/units/{u}/lessons/{l}`) into its ancestor
 *  ids. */
export function parseLessonPath(ref: DocumentReference): LessonPathIds {
  const parts = ref.path.split('/');
  return { seriesId: parts[1], bookId: parts[3], unitId: parts[5], lessonId: parts[7] };
}
