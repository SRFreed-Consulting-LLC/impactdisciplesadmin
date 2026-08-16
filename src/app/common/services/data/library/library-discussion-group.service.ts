import { Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import {
  DocumentReference,
  collection,
  deleteField,
  doc,
  getDocs,
  updateDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { DiscussionGroup, GroupMembership } from '@impact-common/models/discussion-group.model';
import { GroupWizardResult } from '@impact-common/groups/group-wizard-dialog.component';
import { getAllGroups, getGroupMembers } from '@impact-common/queries/discussion-group-queries';
import { libraryFirestore } from './library-firestore.util';

/**
 * Ported from impact-discipleship-library-manager-new's own
 * DiscussionGroupService - admin-side writer for the Impact Groups module
 * (list/edit/hard-delete any group), distinct from the reader app's own
 * DiscussionGroupService (which only ever acts on behalf of a library
 * user's own actions). Reads/writes `discussionGroups` in the named
 * 'impactdiscipleship-books' database via libraryFirestore(app) - see that
 * factory's own comment for why this MUST NOT go through the shared
 * injected Firestore instance. getAllGroups()/getGroupMembers() are the
 * shared submodule's plain-function queries (same ones the reader app
 * uses), not reimplemented here.
 */
@Injectable({ providedIn: 'root' })
export class LibraryDiscussionGroupService {
  constructor(private app: FirebaseApp) {}

  getAllGroups(): Observable<DiscussionGroup[]> {
    return getAllGroups(libraryFirestore(this.app));
  }

  getGroupMembers(groupId: string): Observable<GroupMembership[]> {
    return getGroupMembers(libraryFirestore(this.app), groupId);
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
    await updateDoc(doc(libraryFirestore(this.app), 'discussionGroups', groupId), {
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
  }

  /** Real hard delete (group doc + every subcollection) - unlike the
   *  reader app, which deliberately never exposes this (closing a group
   *  only hides it from Browse), admin moderation needs an actual delete.
   *  Batched rather than one deleteDoc() network round trip per document -
   *  a busy/long-running group's chat or conversation history could easily
   *  be hundreds of documents. */
  async deleteGroup(groupId: string): Promise<void> {
    const firestore = libraryFirestore(this.app);
    const refs: DocumentReference[] = [];
    for (const sub of ['members', 'chatMessages']) {
      const snap = await getDocs(collection(firestore, 'discussionGroups', groupId, sub));
      refs.push(...snap.docs.map((d) => d.ref));
    }
    const conversationsSnap = await getDocs(
      collection(firestore, 'discussionGroups', groupId, 'conversations'),
    );
    const conversationMessageSnaps = await Promise.all(
      conversationsSnap.docs.map((conversationDoc) =>
        getDocs(
          collection(
            firestore,
            'discussionGroups',
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
    refs.push(doc(firestore, 'discussionGroups', groupId));
    await this.commitDeletesInChunks(refs);
  }

  /** Firestore caps a single batch at 500 operations - chunk comfortably
   *  under that. */
  private async commitDeletesInChunks(refs: DocumentReference[]): Promise<void> {
    const CHUNK_SIZE = 400;
    for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
      const batch = writeBatch(libraryFirestore(this.app));
      for (const ref of refs.slice(i, i + CHUNK_SIZE)) {
        batch.delete(ref);
      }
      await batch.commit();
    }
  }
}
