import { Injectable } from '@angular/core';
import {
  Firestore,
  QueryDocumentSnapshot,
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
// generic create/update/delete call on this service exists anywhere.
@Injectable({
  providedIn: 'root'
})
export class LibraryLessonService {
  constructor(
    private firestore: Firestore,
    private authService: AdminAuthService,
    private activityLog: LibraryActivityLogService
  ) {}

  private fromDoc(d: QueryDocumentSnapshot): LibraryLessonModel {
    const { unitId, bookId } = parseLessonPath(d.ref);
    return { id: d.id, unitId, bookId, ...d.data() } as LibraryLessonModel;
  }

  /** A lesson id alone doesn't say which unit it's nested under - scans
   *  every unit's `lessons` subcollection via a collectionGroup query and
   *  matches by the doc's own id. This is the one every full-page editor
   *  route (Lesson Editor, Preview, Translation - all reached via just
   *  `/lessons/:id`) depends on. Fine at this library's real scale (161
   *  lessons total). */
  async getById(id: string): Promise<LibraryLessonModel | undefined> {
    const snap = await this.lessonsCollectionGroup();
    const found = snap.docs.find((d) => d.id === id);
    return found ? this.fromDoc(found) : undefined;
  }

  getByUnit(unitId: string): Promise<LibraryLessonModel[]> {
    return this.lessonsCollectionGroup().then((snap) =>
      snap.docs
        .filter((d) => d.ref.parent.parent?.id === unitId)
        .map((d) => this.fromDoc(d)),
    );
  }

  private lessonsCollectionGroup() {
    return getDocs(collectionGroup(this.firestore, 'lessons'));
  }

  /** Resolves a lesson id to its full Firestore doc reference - every
   *  write method below needs this since a bare lessonId alone can't be
   *  addressed directly under the nested schema the way it could when
   *  `lessons` was still a flat top-level collection. Public (not just
   *  this class's own private helper) so LibraryTranslationService can
   *  resolve a lesson's `translations` subcollection the same way,
   *  without duplicating this same collectionGroup scan. */
  async docRef(lessonId: string) {
    const snap = await this.lessonsCollectionGroup();
    const found = snap.docs.find((d) => d.id === lessonId);
    if (!found) {
      throw new Error(`No lesson found with id ${lessonId}.`);
    }
    return found.ref;
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
