import { tenantPath } from '@impact-common/shared/lists/tenancy';
import { Injectable } from '@angular/core';
import { Firestore, addDoc, collection, deleteDoc, doc, updateDoc } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { BaseService } from '../base.service';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import {
  LibrarySubtemplateModel,
  LibrarySubtemplateType,
} from 'src/app/common/models/domain/library/library-subtemplate.model';
import { LibraryFormioSchema } from 'src/app/common/models/domain/library/library-lesson.model';
import { LibraryActivityLogService } from './library-activity-log.service';

// Reads/writes the `subtemplates` collection in THIS app's own default
// database (Phase 3 migration target) - the injected `FirebaseDAO` is the
// same shared singleton every other service in this app uses now that
// there's no longer a separate named database to avoid colliding with (see
// library-firestore.util.ts, now unused).
@Injectable({
  providedIn: 'root'
})
export class LibrarySubtemplateService extends BaseService<LibrarySubtemplateModel> {
  constructor(
    public override dao: FirebaseDAO<LibrarySubtemplateModel>,
    private firestore: Firestore,
    private authService: AdminAuthService,
    private activityLog: LibraryActivityLogService
  ) {
    super(dao);
    this.table = 'subtemplates';
  }

  private async uid(): Promise<string> {
    const user = await firstValueFrom(this.authService.dao.loggedInUser$);
    return user?.firebaseUID ?? user?.id ?? '';
  }

  async createSubtemplate(title: string, type: LibrarySubtemplateType): Promise<string> {
    const docRef = await addDoc(collection(this.firestore, tenantPath('subtemplates')), {
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
    const ref = doc(this.firestore, tenantPath('subtemplates'), subtemplateId);
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
    await deleteDoc(doc(this.firestore, tenantPath('subtemplates'), subtemplateId));
    await this.activityLog.log('template_deleted', {
      targetName: title,
      detail: `Subtemplate (${type})`
    });
  }
}
