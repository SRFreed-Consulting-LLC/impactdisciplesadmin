import { Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { addDoc, collection, deleteDoc, doc, getDoc, updateDoc } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { getTranslations } from '@impact-common/queries/translation-queries';
import { LessonTranslation, TranslationField } from '@impact-common/models/translation.models';
import { libraryFirestore } from './library-firestore.util';
import { LibraryActivityLogService } from './library-activity-log.service';

export type LibraryDailyReadingTranslation = Pick<
  LessonTranslation,
  'memoryVerse' | 'goal' | 'dailyReadingVerse' | 'monVerse' | 'tueVerse' | 'wedVerse' | 'thuVerse' | 'friVerse'
>;

// Reads/writes `lessons/{id}/translations` in the named
// 'impactdiscipleship-books' database - ported from
// impact-discipleship-library-manager-new's TranslationService, converted
// from live listeners to one-shot reads to match this app's own services'
// convention (every screen so far reloads explicitly after a mutation
// rather than relying on a standing listener).
@Injectable({
  providedIn: 'root'
})
export class LibraryTranslationService {
  constructor(
    private app: FirebaseApp,
    private authService: AdminAuthService,
    private activityLog: LibraryActivityLogService
  ) {}

  private async uid(): Promise<string> {
    const user = await firstValueFrom(this.authService.dao.loggedInUser$);
    return user?.firebaseUID ?? user?.id ?? '';
  }

  private translationsRef(lessonId: string) {
    return collection(libraryFirestore(this.app), 'lessons', lessonId, 'translations');
  }

  getTranslations(lessonId: string): Promise<LessonTranslation[]> {
    return firstValueFrom(getTranslations(libraryFirestore(this.app), lessonId));
  }

  async getTranslation(lessonId: string, translationId: string): Promise<LessonTranslation | undefined> {
    const snap = await getDoc(doc(libraryFirestore(this.app), 'lessons', lessonId, 'translations', translationId));
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
    const docRef = await addDoc(this.translationsRef(lessonId), {
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
    const ref = doc(libraryFirestore(this.app), 'lessons', lessonId, 'translations', translationId);
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
    await deleteDoc(doc(libraryFirestore(this.app), 'lessons', lessonId, 'translations', translationId));
    await this.activityLog.log('translation_deleted', {
      targetName: `${localeLabel} translation of "${lessonTitle}"`,
      detail: 'Lesson translation'
    });
  }
}
