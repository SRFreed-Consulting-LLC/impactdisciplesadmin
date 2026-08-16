import { Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { addDoc, collection, deleteDoc, doc, updateDoc } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { BaseService } from '../base.service';
import {
  LibrarySubtemplateModel,
  LibrarySubtemplateType,
} from 'src/app/common/models/domain/library/library-subtemplate.model';
import { LibraryFormioSchema } from 'src/app/common/models/domain/library/library-lesson.model';
import { libraryFirestore, libraryFirestoreDAO } from './library-firestore.util';
import { LibraryActivityLogService } from './library-activity-log.service';

// Reads/writes the `subtemplates` collection in the named
// 'impactdiscipleship-books' database - see library-firestore.util.ts's own
// comment for why this MUST construct its DAO through that factory rather
// than injecting the shared one.
@Injectable({
  providedIn: 'root'
})
export class LibrarySubtemplateService extends BaseService<LibrarySubtemplateModel> {
  constructor(
    private app: FirebaseApp,
    private authService: AdminAuthService,
    private activityLog: LibraryActivityLogService
  ) {
    super(libraryFirestoreDAO<LibrarySubtemplateModel>(app));
    this.table = 'subtemplates';
  }

  private async uid(): Promise<string> {
    const user = await firstValueFrom(this.authService.dao.loggedInUser$);
    return user?.firebaseUID ?? user?.id ?? '';
  }

  async createSubtemplate(title: string, type: LibrarySubtemplateType): Promise<string> {
    const docRef = await addDoc(collection(libraryFirestore(this.app), 'subtemplates'), {
      title,
      type,
      formSchema: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: await this.uid(),
      updatedBy: await this.uid()
    });
    await this.activityLog.log('template_created', {
      targetName: title,
      detail: `Subtemplate (${type})`
    });
    return docRef.id;
  }

  /** Partial `updateDoc()`, not `BaseService.update()` - see
   *  LibraryLessonService.saveLessonForm()'s identical note on why. */
  async saveSubtemplateForm(
    subtemplateId: string,
    formSchema: LibraryFormioSchema,
    type: LibrarySubtemplateType,
    title: string
  ): Promise<void> {
    const ref = doc(libraryFirestore(this.app), 'subtemplates', subtemplateId);
    await updateDoc(ref, { formSchema, type, title, updatedAt: Date.now(), updatedBy: await this.uid() });
    await this.activityLog.log('template_updated', {
      targetName: title,
      detail: `Subtemplate (${type})`
    });
  }

  async deleteSubtemplate(
    subtemplateId: string,
    title: string,
    type: LibrarySubtemplateType
  ): Promise<void> {
    await deleteDoc(doc(libraryFirestore(this.app), 'subtemplates', subtemplateId));
    await this.activityLog.log('template_deleted', {
      targetName: title,
      detail: `Subtemplate (${type})`
    });
  }
}
