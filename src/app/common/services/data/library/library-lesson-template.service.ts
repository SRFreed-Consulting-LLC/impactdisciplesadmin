import { Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { addDoc, collection, deleteDoc, doc, updateDoc } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { BaseService } from '../base.service';
import { LibraryLessonTemplateModel } from 'src/app/common/models/domain/library/library-lesson-template.model';
import { libraryFirestore, libraryFirestoreDAO } from './library-firestore.util';
import { LibraryActivityLogService } from './library-activity-log.service';

export type LibraryLessonTemplateSlots = Pick<
  LibraryLessonTemplateModel,
  'headerSubtemplateId' | 'layoutSubtemplateId' | 'footerSubtemplateId'
>;

// Reads/writes the `lessonTemplates` collection in the named
// 'impactdiscipleship-books' database - see library-firestore.util.ts's own
// comment for why this MUST construct its DAO through that factory rather
// than injecting the shared one.
@Injectable({
  providedIn: 'root'
})
export class LibraryLessonTemplateService extends BaseService<LibraryLessonTemplateModel> {
  constructor(
    private app: FirebaseApp,
    private authService: AdminAuthService,
    private activityLog: LibraryActivityLogService
  ) {
    super(libraryFirestoreDAO<LibraryLessonTemplateModel>(app));
    this.table = 'lessonTemplates';
  }

  private async uid(): Promise<string> {
    const user = await firstValueFrom(this.authService.dao.loggedInUser$);
    return user?.firebaseUID ?? user?.id ?? '';
  }

  async createLessonTemplate(title: string): Promise<string> {
    const docRef = await addDoc(collection(libraryFirestore(this.app), 'lessonTemplates'), {
      title,
      headerSubtemplateId: null,
      layoutSubtemplateId: null,
      footerSubtemplateId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: await this.uid(),
      updatedBy: await this.uid()
    });
    await this.activityLog.log('template_created', { targetName: title, detail: 'Lesson Template' });
    return docRef.id;
  }

  /** Partial `updateDoc()`, not `BaseService.update()` - see
   *  LibraryLessonService.saveLessonForm()'s identical note on why. */
  async saveLessonTemplateSlots(
    lessonTemplateId: string,
    slots: LibraryLessonTemplateSlots,
    title: string
  ): Promise<void> {
    const ref = doc(libraryFirestore(this.app), 'lessonTemplates', lessonTemplateId);
    await updateDoc(ref, { ...slots, title, updatedAt: Date.now(), updatedBy: await this.uid() });
    await this.activityLog.log('template_updated', { targetName: title, detail: 'Lesson Template' });
  }

  async deleteLessonTemplate(lessonTemplateId: string, title: string): Promise<void> {
    await deleteDoc(doc(libraryFirestore(this.app), 'lessonTemplates', lessonTemplateId));
    await this.activityLog.log('template_deleted', { targetName: title, detail: 'Lesson Template' });
  }
}
