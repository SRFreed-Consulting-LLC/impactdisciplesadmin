import { Injectable } from '@angular/core';
import { Firestore, addDoc, collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { LessonTranslation, TranslationField } from '@impact-common/models/translation.models';
import { LibraryLessonService } from './library-lesson.service';
import { LibraryActivityLogService } from './library-activity-log.service';

export type LibraryDailyReadingTranslation = Pick<
  LessonTranslation,
  'memoryVerse' | 'goal' | 'dailyReadingVerse' | 'monVerse' | 'tueVerse' | 'wedVerse' | 'thuVerse' | 'friVerse'
>;

// Reads/writes `.../lessons/{lessonId}/translations` - one level deeper
// than before Phase 3's migration (lessons themselves are now nested under
// librarySeries/{s}/books/{b}/units/{u}, not a flat top-level collection),
// so every method here resolves the lesson's own doc reference via
// LibraryLessonService.docRef() first (a collectionGroup scan - see that
// service's own comment) rather than addressing `lessons/{lessonId}`
// directly the way the old flat schema allowed.
@Injectable({
  providedIn: 'root'
})
export class LibraryTranslationService {
  constructor(
    private firestore: Firestore,
    private authService: AdminAuthService,
    private lessons: LibraryLessonService,
    private activityLog: LibraryActivityLogService
  ) {}

  private async uid(): Promise<string> {
    const user = await firstValueFrom(this.authService.dao.loggedInUser$);
    return user?.firebaseUID ?? user?.id ?? '';
  }

  private async translationsRef(lessonId: string) {
    const lessonRef = await this.lessons.docRef(lessonId);
    return collection(lessonRef, 'translations');
  }

  async getTranslations(lessonId: string): Promise<LessonTranslation[]> {
    const snap = await getDocs(await this.translationsRef(lessonId));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LessonTranslation);
  }

  async getTranslation(lessonId: string, translationId: string): Promise<LessonTranslation | undefined> {
    const lessonRef = await this.lessons.docRef(lessonId);
    const snap = await getDoc(doc(lessonRef, 'translations', translationId));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as LessonTranslation) : undefined;
  }

  async createTranslation(
    lessonId: string,
    locale: string,
    localeLabel: string,
    fields: TranslationField[],
    lessonTitle: string
  ): Promise<string> {
    const uid = await this.uid();
    const docRef = await addDoc(await this.translationsRef(lessonId), {
      lessonId,
      locale,
      localeLabel,
      fields,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: uid,
      updatedBy: uid
    });
    await this.activityLog.log('translation_created', {
      targetName: `${localeLabel} translation of "${lessonTitle}"`,
      detail: 'Lesson translation'
    });
    return docRef.id;
  }

  async updateTranslationFields(
    lessonId: string,
    translationId: string,
    fields: TranslationField[],
    dailyReading: LibraryDailyReadingTranslation,
    localeLabel: string,
    lessonTitle: string
  ): Promise<void> {
    const lessonRef = await this.lessons.docRef(lessonId);
    const ref = doc(lessonRef, 'translations', translationId);
    await updateDoc(ref, { fields, ...dailyReading, updatedAt: Date.now(), updatedBy: await this.uid() });
    await this.activityLog.log('translation_updated', {
      targetName: `${localeLabel} translation of "${lessonTitle}"`,
      detail: 'Lesson translation'
    });
  }

  async deleteTranslation(
    lessonId: string,
    translationId: string,
    localeLabel: string,
    lessonTitle: string
  ): Promise<void> {
    const lessonRef = await this.lessons.docRef(lessonId);
    await deleteDoc(doc(lessonRef, 'translations', translationId));
    await this.activityLog.log('translation_deleted', {
      targetName: `${localeLabel} translation of "${lessonTitle}"`,
      detail: 'Lesson translation'
    });
  }
}
