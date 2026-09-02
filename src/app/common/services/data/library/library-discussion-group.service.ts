import { tenantPath } from '@impact-common/shared/lists/tenancy';
import { Injectable } from '@angular/core';
import {
  DocumentReference,
  Firestore,
  collection,
  collectionGroup,
  deleteField,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { DiscussionGroup, GroupMembership } from '@impact-common/models/discussion-group.model';
import { GroupWizardResult } from '@impact-common/groups/group-wizard-dialog.component';
import { getAllGroups, getGroupMembers } from '@impact-common/queries/discussion-group-queries';
import { LibraryActivityLogService } from './library-activity-log.service';

/**
 * Ported from impact-discipleship-library-manager-new's own
 * DiscussionGroupService - admin-side writer for the Impact Groups module
 * (list/edit/hard-delete any group), distinct from the reader app's own
 * DiscussionGroupService (which only ever acts on behalf of a library
 * user's own actions). Reads/writes `discussionGroups` in THIS app's own
 * default database (Phase 3 migration target). getAllGroups()/
 * getGroupMembers() are the shared submodule's plain-function queries
 * (same ones the reader app uses), not reimplemented here.
 */
@Injectable({ providedIn: 'root' })
export class LibraryDiscussionGroupService {
  constructor(
    private firestore: Firestore,
    private activityLog: LibraryActivityLogService
  ) {}

  getAllGroups(): Observable<DiscussionGroup[]> {
    return getAllGroups(this.firestore);
  }

  getGroupMembers(groupId: string): Observable<GroupMembership[]> {
    return getGroupMembers(this.firestore, groupId);
  }

  /** EVERY membership doc across EVERY group, any status - one unfiltered
   *  `collectionGroup('members')` read. Deliberately NOT in the shared
   *  submodule alongside getMyMemberships/getGroupMembers: those are
   *  email-scoped and group-scoped because that is all firestore.rules lets
   *  a patron read, whereas the unfiltered form is admin-only (see that
   *  rule file's `match /{path=**}/members/{memberEmail}` isAdminRole()
   *  branch). Keeping it here keeps a query no patron app may run out of
   *  the code all three apps share.
   *
   *  A one-shot getDocs rather than a live listener - its only caller (the
   *  Digital Book Users report) joins it against three other one-shot
   *  fetches, so a live feed on just this one would give a half-fresh join.
   *  Membership docs carry their own `groupId`, so collection-group results
   *  are joinable back to a group without walking each ref's path. */
  async getAllMemberships(): Promise<GroupMembership[]> {
    const snap = await getDocs(collectionGroup(this.firestore, 'members'));
    return snap.docs.map((d) => d.data() as GroupMembership);
  }

  /** Full edit of any group's content - book, title, description, meeting
   *  format, location, and visibility. Fields the wizard doesn't offer for
   *  the edited group's current state (e.g. `location` when in-person was
   *  turned off) are explicitly cleared with `deleteField()` rather than
   *  merely omitted, since a plain `updateDoc` only touches keys present in
   *  the payload - an omitted key leaves whatever was already there
   *  intact, which would silently keep a stale location/onlineInfo around.
   *  Also always clears the legacy `inPersonLocation` string field: any
   *  save through this wizard supersedes it with the current structured
   *  `location` (or its absence). Creator/leader is intentionally not
   *  editable here. */
  async updateGroup(groupId: string, input: GroupWizardResult): Promise<void> {
    await updateDoc(doc(this.firestore, tenantPath('discussionGroups'), groupId), {
      bookId: input.bookId,
      title: input.title,
      description: input.description ?? deleteField(),
      location: input.location ?? deleteField(),
      onlineInfo: input.onlineInfo ?? deleteField(),
      inPersonLocation: deleteField(),
      startDate: input.startDate,
      startTimeZone: input.startTimeZone,
      groupVisibility: input.groupVisibility,
      maxMembers: input.maxMembers ?? deleteField(),
      updatedAt: Date.now(),
    });
    // Logged HERE rather than in the Groups screen so every caller is
    // covered, matching how library-book.service records its own edits.
    await this.activityLog.log('group_updated', {
      targetName: input.title,
      detail: 'Edited Impact Group',
    });
  }

  /** Real hard delete (group doc + every subcollection) - unlike the
   *  reader app, which deliberately never exposes this (closing a group
   *  only hides it from Browse), admin moderation needs an actual delete.
   *  Batched rather than one deleteDoc() network round trip per document -
   *  a busy/long-running group's chat or conversation history could easily
   *  be hundreds of documents. */
  async deleteGroup(groupId: string): Promise<void> {
    const firestore = this.firestore;
    // Read the title BEFORE destroying it - an audit entry saying only
    // "deleted <id>" is close to useless when someone asks months later
    // which group went missing. Best-effort: a failure here must not stop
    // the moderation action.
    let title = groupId;
    try {
      const snap = await getDoc(doc(firestore, tenantPath('discussionGroups'), groupId));
      title = (snap.data()?.['title'] as string) || groupId;
    } catch {
      // Keep the id as the label.
    }
    const refs: DocumentReference[] = [];
    for (const sub of ['members', 'chatMessages', 'prayerRequests']) {
      const snap = await getDocs(collection(firestore, tenantPath('discussionGroups'), groupId, sub));
      refs.push(...snap.docs.map((d) => d.ref));
    }
    const conversationsSnap = await getDocs(
      collection(firestore, tenantPath('discussionGroups'), groupId, 'conversations'),
    );
    const conversationMessageSnaps = await Promise.all(
      conversationsSnap.docs.map((conversationDoc) =>
        getDocs(
          collection(
            firestore,
            tenantPath('discussionGroups'),
            groupId,
            'conversations',
            conversationDoc.id,
            'messages',
          ),
        ),
      ),
    );
    conversationsSnap.docs.forEach((conversationDoc, i) => {
      refs.push(...conversationMessageSnaps[i].docs.map((d) => d.ref), conversationDoc.ref);
    });
    refs.push(doc(firestore, tenantPath('discussionGroups'), groupId));
    await this.commitDeletesInChunks(refs);
    // The only destructive action in the library area, and it takes every
    // message, prayer request and conversation with it - so the count goes
    // in the entry too. It is the difference between "a group was removed"
    // and "147 documents were removed".
    await this.activityLog.log('group_deleted', {
      targetName: title,
      detail: `Deleted Impact Group and ${refs.length - 1} related document(s)`,
    });
  }

  /** Firestore caps a single batch at 500 operations - chunk comfortably
   *  under that. */
  private async commitDeletesInChunks(refs: DocumentReference[]): Promise<void> {
    const CHUNK_SIZE = 400;
    for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
      const batch = writeBatch(this.firestore);
      for (const ref of refs.slice(i, i + CHUNK_SIZE)) {
        batch.delete(ref);
      }
      await batch.commit();
    }
  }
}
