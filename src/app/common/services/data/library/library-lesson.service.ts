import { Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { doc, getDoc, updateDoc } from '@angular/fire/firestore';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { firstValueFrom } from 'rxjs';
import { BaseService } from '../base.service';
import {
  LibraryFormioSchema,
  LibraryLessonModel,
} from 'src/app/common/models/domain/library/library-lesson.model';
import { libraryFirestore, libraryFirestoreDAO } from './library-firestore.util';
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

// Reads/writes the `lessons` collection in the named 'impactdiscipleship-books'
// database - see library-firestore.util.ts's own comment for why this MUST
// construct its DAO through that factory rather than injecting the shared one.
@Injectable({
  providedIn: 'root'
})
export class LibraryLessonService extends BaseService<LibraryLessonModel> {
  constructor(
    private app: FirebaseApp,
    private authService: AdminAuthService,
    private activityLog: LibraryActivityLogService
  ) {
    super(libraryFirestoreDAO<LibraryLessonModel>(app));
    this.table = 'lessons';
  }

  getByUnit(unitId: string): Promise<LibraryLessonModel[]> {
    return this.getAllByValue('unitId', unitId);
  }

  private async uid(): Promise<string> {
    const user = await firstValueFrom(this.authService.dao.loggedInUser$);
    return user?.firebaseUID ?? user?.id ?? '';
  }

  /** Partial `updateDoc()`, NOT `BaseService.update()` - that does a full
   *  `setDoc` with no merge (see FirebaseDAO.update()'s own implementation),
   *  which would blow away every field on the lesson doc this method doesn't
   *  explicitly pass (title, order, unitId, bookId, ...). Returns the new
   *  version string so callers can reflect it without a re-fetch. `title` is
   *  only for the activity log entry - the doc's own title isn't changed here. */
  async saveLessonForm(
    lessonId: string,
    formSchema: LibraryFormioSchema,
    title: string
  ): Promise<string> {
    const ref = doc(libraryFirestore(this.app), 'lessons', lessonId);
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
    const ref = doc(libraryFirestore(this.app), 'lessons', lessonId);
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
