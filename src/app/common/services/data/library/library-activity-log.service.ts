import { Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { addDoc, collection } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import {
  LibraryActivityAction,
  LibraryActivityLogEntry,
} from 'src/app/common/models/domain/library/library-activity-log.model';
import { libraryFirestore } from './library-firestore.util';

/**
 * Library content-edit audit trail - who created/edited/deleted which
 * series/book/unit/lesson/template. Writes to the `activityLog` collection
 * in the named 'impactdiscipleship-books' database, same shape/table the
 * source app used - NOT the same thing as this app's own LoggerService
 * ("log-messages", error/diagnostic logging - see the consolidation plan's
 * "Decided - logging"). Write-only for now (Slice 2's Lesson Editor is the
 * only caller so far) - a viewer screen (matching the source app's own
 * Activity Log) is a later slice; get/delete methods land with it.
 */
@Injectable({
  providedIn: 'root'
})
export class LibraryActivityLogService {
  constructor(
    private app: FirebaseApp,
    private authService: AdminAuthService
  ) {}

  async log(
    action: LibraryActivityAction,
    context: { targetName?: string; detail?: string } = {}
  ): Promise<void> {
    // One-shot read off the live auth state rather than caching a running
    // `currentUser` field (see PermissionService's own comment on why it
    // caches) - a fire-and-forget audit write doesn't need to stay reactive,
    // just needs "whoever is signed in right now".
    const user: AdminUser | undefined = await firstValueFrom(this.authService.dao.loggedInUser$);
    if (!user) {
      return;
    }
    const entry: LibraryActivityLogEntry = {
      actorUid: user.firebaseUID ?? user.id ?? '',
      actorName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || user.id || '',
      action,
      targetName: context.targetName ?? null,
      detail: context.detail ?? null,
      timestamp: Date.now()
    };
    await addDoc(collection(libraryFirestore(this.app), 'activityLog'), entry);
  }
}
