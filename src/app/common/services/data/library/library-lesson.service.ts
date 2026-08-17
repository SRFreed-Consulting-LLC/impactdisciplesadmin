import { Injectable } from '@angular/core';
import {
  DocumentReference,
  Firestore,
  QueryDocumentSnapshot,
  collection,
  collectionGroup,
  getDoc,
  getDocs,
  updateDoc,
} from '@angular/fire/firestore';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { firstValueFrom } from 'rxjs';
import {
  LibraryFormioSchema,
  LibraryLessonModel,
} from 'src/app/common/models/domain/library/library-lesson.model';
import { parseLessonPath } from './library-nested-path.util';
import { LibraryActivityLogService } from './library-activity-log.service';
import { LibraryUnitService } from './library-unit.service';

export type LibraryDailyReadingPlan = Pick<
  LibraryLessonModel,
  | 'showDailyReading'
  | 'dailyReadingVerse'
  | 'goal'
  | 'memoryVerse'
  | 'monVerse'
  | 'tueVerse'
  | 'wedVerse'
  | 'thuVerse'
  | 'friVerse'
>;

/** "2026.07.27.1" -> "2026.07.27.2"; rolls over to ".1" on a new calendar day
 *  or if there's no prior version to build on. Ported verbatim from
 *  impact-discipleship-library-manager-new's library.service.ts. */
function nextLessonVersion(previous: string | undefined): string {
  const now = new Date();
  const today = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  const match = previous?.match(/^(\d{4}\.\d{2}\.\d{2})\.(\d+)$/);
  const count = match && match[1] === today ? Number(match[2]) + 1 : 1;
  return `${today}.${count}`;
}

// Reads/writes the `lessons` subcollection nested under
// `librarySeries/{seriesId}/books/{bookId}/units/{unitId}` in THIS app's
// own default database (Phase 3 migration target) - see
// library-nested-path.util.ts's own comment on why `unitId`/`bookId` stay
// fields on LibraryLessonModel (populated from the doc's own path at read
// time) even though they're no longer stored in Firestore itself.
//
// Only getById()/getByUnit() plus the two custom write methods below are
// implemented - confirmed via a full grep of every Library screen that no
// generic create/update/delete call on this service exists anywhere. The
// one writer that CREATES lessons is LibraryImportBookService, which calls
// invalidateRefs() after creating docs - see the ref-memo comment on
// lessonRefs() below. (This service's own write methods are updateDoc-only:
// they change content, never a doc's path, so they don't invalidate.)
@Injectable({
  providedIn: 'root'
})
export class LibraryLessonService {
  /** Lazily-built shared id -> DocumentReference map over every `lessons`
   *  subcollection. See lessonRefs() for the memoization contract. */
  private refsPromise: Promise<Map<string, DocumentReference>> | null = null;

  constructor(
    private firestore: Firestore,
    private authService: AdminAuthService,
    private activityLog: LibraryActivityLogService,
    private units: LibraryUnitService
  ) {}

  private fromDoc(d: QueryDocumentSnapshot): LibraryLessonModel {
    const { unitId, bookId } = parseLessonPath(d.ref);
    return { id: d.id, unitId, bookId, ...d.data() } as LibraryLessonModel;
  }

  /** The one collectionGroup('lessons') scan this service runs - AT MOST
   *  once per app session (or once per invalidateRefs()), NOT once per
   *  getById()/docRef() call as it originally did (that re-downloaded every
   *  lesson's full formSchema - 161 lessons, tens to hundreds of KB each -
   *  on every editor open AND every save). It exists only to resolve a bare
   *  lesson id to its full nested DocumentReference; document DATA is never
   *  served from this memo (content edits don't move docs, so a cached
   *  REFERENCE can't go stale the way cached data would) - getById() always
   *  follows up with a fresh getDoc(). A failed scan is never memoized, so
   *  a transient offline/permission error doesn't poison the whole
   *  session. */
  private lessonRefs(): Promise<Map<string, DocumentReference>> {
    if (!this.refsPromise) {
      const scan = getDocs(collectionGroup(this.firestore, 'lessons')).then(
        (snap) => new Map<string, DocumentReference>(snap.docs.map((d) => [d.id, d.ref])),
      );
      scan.catch(() => {
        if (this.refsPromise === scan) {
          this.refsPromise = null;
        }
      });
      this.refsPromise = scan;
    }
    return this.refsPromise;
  }

  /** Forget the memoized id -> ref map so the next lookup re-scans. Must be
   *  called after any operation that creates, deletes, or moves lesson docs
   *  (currently only LibraryImportBookService). */
  invalidateRefs(): void {
    this.refsPromise = null;
  }

  /** A lesson id alone doesn't say which unit it's nested under - resolves
   *  the ref via the memoized id -> ref map (one collectionGroup scan per
   *  session, not per call), then fetches the doc's CONTENT fresh with
   *  getDoc(). This is the one every full-page editor route (Lesson Editor,
   *  Preview, Translation - all reached via just `/lessons/:id`) depends
   *  on. */
  async getById(id: string): Promise<LibraryLessonModel | undefined> {
    const map = await this.lessonRefs();
    const ref = map.get(id);
    if (!ref) {
      return undefined;
    }
    const snap = await getDoc(ref);
    return snap.exists() ? this.fromDoc(snap) : undefined;
  }

  /** Resolves the unit's own DocumentReference via LibraryUnitService's
   *  memoized id -> ref map, then issues a fresh, cheap nested getDocs() on
   *  just that unit's `lessons` subcollection - no per-call collectionGroup
   *  scan. An unknown unitId returns [] (same as the old scan-and-filter
   *  behavior). */
  async getByUnit(unitId: string): Promise<LibraryLessonModel[]> {
    const unitRef = await this.units.refById(unitId);
    if (!unitRef) {
      return [];
    }
    const snap = await getDocs(collection(unitRef, 'lessons'));
    return snap.docs.map((d) => this.fromDoc(d));
  }

  /** Resolves a lesson id to its full Firestore doc reference - every
   *  write method below needs this since a bare lessonId alone can't be
   *  addressed directly under the nested schema the way it could when
   *  `lessons` was still a flat top-level collection. Public (not just
   *  this class's own private helper) so LibraryTranslationService can
   *  resolve a lesson's `translations` subcollection the same way. Served
   *  from the memoized id -> ref map (see lessonRefs()) - a reference is
   *  stable across content edits, so re-running this on every save no
   *  longer re-downloads the whole collection. */
  async docRef(lessonId: string): Promise<DocumentReference> {
    const map = await this.lessonRefs();
    const ref = map.get(lessonId);
    if (!ref) {
      throw new Error(`No lesson found with id ${lessonId}.`);
    }
    return ref;
  }

  private async uid(): Promise<string> {
    const user = await firstValueFrom(this.authService.dao.loggedInUser$);
    return user?.firebaseUID ?? user?.id ?? '';
  }

  /** Partial `updateDoc()` - blowing away every other field on the lesson
   *  doc this method doesn't explicitly pass (title, order, ...) would be
   *  a real regression, same reasoning as before this app had any Library
   *  content at all. Returns the new version string so callers can
   *  reflect it without a re-fetch. `title` is only for the activity log
   *  entry - the doc's own title isn't changed here. */
  async saveLessonForm(
    lessonId: string,
    formSchema: LibraryFormioSchema,
    title: string
  ): Promise<string> {
    const ref = await this.docRef(lessonId);
    const snapshot = await getDoc(ref);
    const version = nextLessonVersion(snapshot.data()?.['version'] as string | undefined);
    await updateDoc(ref, {
      formSchema,
      status: 'published',
      version,
      updatedAt: Date.now(),
      updatedBy: await this.uid()
    });
    await this.activityLog.log('node_updated', {
      targetName: title,
      detail: `Published Lesson content (v${version})`
    });
    return version;
  }

  async saveDailyReadingPlan(
    lessonId: string,
    plan: LibraryDailyReadingPlan,
    title: string
  ): Promise<void> {
    const ref = await this.docRef(lessonId);
    await updateDoc(ref, {
      ...plan,
      updatedAt: Date.now(),
      updatedBy: await this.uid()
    });
    await this.activityLog.log('node_updated', {
      targetName: title,
      detail: 'Updated daily reading plan for Lesson'
    });
  }
}
