import { Injectable } from '@angular/core';
import { Firestore, addDoc, collection, collectionData, deleteDoc, doc, limit, orderBy, query } from '@angular/fire/firestore';
import { Observable, firstValueFrom } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import {
  LibraryActivityAction,
  LibraryActivityLogEntry,
} from 'src/app/common/models/domain/library/library-activity-log.model';

/**
 * Library content-edit + account/access audit trail - who created/edited/
 * deleted which series/book/unit/lesson/template/permission/config
 * tier/library user action. Reads/writes the `activityLog` collection in
 * THIS app's own default database (Phase 3 migration target) - NOT the
 * same thing as this app's own LoggerService ("log-messages", error/
 * diagnostic logging - see the consolidation plan's "Decided - logging").
 * Per explicit instruction, historical activityLog entries from the old
 * named database were deliberately NOT migrated (deleted, not carried
 * forward) - this collection starts empty and accumulates fresh entries
 * going forward only. getAllActivity()/deleteEntry()/deleteEntries() back
 * the Activity Log viewer (Slice 5) - log() alone was all Slice 2-4's
 * write-only callers needed.
 */
@Injectable({
  providedIn: 'root'
})
export class LibraryActivityLogService {
  constructor(
    private firestore: Firestore,
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
    await addDoc(collection(this.firestore, 'activityLog'), entry);
  }

  /** All events across every user, most recent first - backs the Activity
   *  Log screen. Filtering there is entirely client-side, so this just
   *  needs a sane cap rather than true pagination - same 500-entry cap as
   *  this app's own activity-log-equivalent lists. */
  getAllActivity(max = 500): Observable<LibraryActivityLogEntry[]> {
    return collectionData(
      query(
        collection(this.firestore, 'activityLog'),
        orderBy('timestamp', 'desc'),
        limit(max),
      ),
      { idField: 'id' },
    ) as Observable<LibraryActivityLogEntry[]>;
  }

  /** Admin-only (see firestore.rules) - the Activity Log screen's per-row
   *  and bulk delete. */
  deleteEntry(id: string): Promise<void> {
    return deleteDoc(doc(this.firestore, 'activityLog', id));
  }

  async deleteEntries(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.deleteEntry(id)));
  }
}
