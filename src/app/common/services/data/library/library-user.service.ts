import { Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, collectionData, doc, docData, limit, orderBy, query } from '@angular/fire/firestore';
import { Observable, map, shareReplay } from 'rxjs';
import { newCorrelationId, attachCorrelationId } from '@impact-common/errors/correlation-id';
import { AdminMessage } from '@impact-common/models/library-user-message.model';
import { LibraryUser } from 'src/app/common/models/domain/library/library-user.model';
import { LibraryActivityLogService } from './library-activity-log.service';

/**
 * The `libraryUsers` collection - owned and written by the reader app
 * (impact-discipleship-library-new), read here in THIS app's own default
 * database (Phase 3 migration target). Ported from
 * impact-discipleship-library-manager-new's own LibraryUserService - first
 * just the read side (Slice 4 part 2, backing the World Map), now extended
 * with the write methods (Slice 4 part 4, the Library Users screen) -
 * every write here goes through one of the 5 Library Users Cloud Functions
 * ported into this app's own `functions/src` (library-users.functions.ts),
 * never a direct client write: firestore.rules scopes `libraryUsers`
 * writes to the owner's own email, so an admin's client session can never
 * write another user's doc.
 */
@Injectable({ providedIn: 'root' })
export class LibraryUserService {
  constructor(
    private firestore: Firestore,
    private functions: Functions,
    private activityLog: LibraryActivityLogService,
  ) {}

  /** Every library user, sorted by name (email as the tiebreak/fallback) -
   *  sorted client-side since the collection is small and `firstName` is
   *  optional.
   *
   *  shareReplay makes this ONE live Firestore listener shared across every
   *  subscriber (e.g. the World Map and, later, the Library Users list)
   *  instead of each subscription opening its own - collectionData()
   *  returns a cold observable by default. refCount: true tears the shared
   *  listener down once nothing is subscribed, rather than leaking it for
   *  the rest of the session. */
  private readonly libraryUsers$ = (
    collectionData(collection(this.firestore, 'libraryUsers'), {
      idField: 'id',
    }) as Observable<LibraryUser[]>
  ).pipe(
    map((users) =>
      [...users].sort((a, b) => {
        const nameA = [a.firstName, a.lastName].filter(Boolean).join(' ') || a.email || a.id;
        const nameB = [b.firstName, b.lastName].filter(Boolean).join(' ') || b.email || b.id;
        return nameA.localeCompare(nameB);
      }),
    ),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  getLibraryUsers(): Observable<LibraryUser[]> {
    return this.libraryUsers$;
  }

  getLibraryUser(email: string): Observable<LibraryUser | undefined> {
    const ref = doc(this.firestore, 'libraryUsers', email.trim().toLowerCase());
    return docData(ref, { idField: 'id' }) as Observable<LibraryUser | undefined>;
  }

  /** Sent-broadcast history (adminMessages summaries), newest first -
   *  admin-only read under firestore.rules. Capped at 500, same "growing
   *  history list" safety-net pattern as this app's own activity log -
   *  broadcasts are infrequent in practice. */
  getAdminMessages(): Observable<AdminMessage[]> {
    const ref = collection(this.firestore, 'adminMessages');
    return collectionData(query(ref, orderBy('sentAt', 'desc'), limit(500)), {
      idField: 'id',
    }) as Observable<AdminMessage[]>;
  }

  /** Admin edit of the allowlisted low-stakes profile fields - see the
   *  updateLibraryUser Cloud Function for what's editable and why. */
  async updateLibraryUser(
    email: string,
    changes: { firstName?: string; lastName?: string; phone?: string; internationalUser?: boolean },
    targetName: string,
  ): Promise<void> {
    const correlationId = newCorrelationId();
    const fn = httpsCallable<Record<string, unknown>, { email: string }>(
      this.functions,
      'updateLibraryUser',
    );
    try {
      await fn({ email, ...changes, correlationId });
    } catch (err) {
      throw attachCorrelationId(err, correlationId);
    }
    await this.activityLog.log('library_user_updated', {
      targetName,
    });
  }

  /** Reversible access revocation: disables/re-enables the Auth account
   *  and stamps the doc's `revoked` flag (setLibraryUserRevoked Cloud
   *  Function). Returns whether a Firebase Auth account existed for the
   *  email - false for legacy-import docs whose owner never signed in. */
  async setRevoked(email: string, revoked: boolean, targetName: string): Promise<boolean> {
    const correlationId = newCorrelationId();
    const fn = httpsCallable<
      { email: string; revoked: boolean; correlationId: string },
      { email: string; revoked: boolean; authAccountFound: boolean }
    >(this.functions, 'setLibraryUserRevoked');
    let result;
    try {
      result = await fn({ email, revoked, correlationId });
    } catch (err) {
      throw attachCorrelationId(err, correlationId);
    }
    await this.activityLog.log(revoked ? 'library_user_revoked' : 'library_user_reinstated', {
      targetName,
    });
    return result.data.authAccountFound;
  }

  /** Admin-comped licenses (grantLibraryUserLicenses Cloud Function) -
   *  already-covered books are skipped, not overwritten. */
  async grantLicenses(
    email: string,
    bookIds: string[],
    targetName: string,
    bookTitles: string[],
  ): Promise<{ granted: string[]; skipped: string[] }> {
    const correlationId = newCorrelationId();
    const fn = httpsCallable<
      { email: string; bookIds: string[]; correlationId: string },
      { granted: string[]; skipped: string[] }
    >(this.functions, 'grantLibraryUserLicenses');
    let result;
    try {
      result = await fn({ email, bookIds, correlationId });
    } catch (err) {
      throw attachCorrelationId(err, correlationId);
    }
    if (result.data.granted.length > 0) {
      await this.activityLog.log('library_user_license_granted', {
        targetName,
        detail: bookTitles.join(', '),
      });
    }
    return result.data;
  }

  /** Removes one admin-granted license (revokeAdminGrantedLicense Cloud
   *  Function) - purchase/group-sourced licenses are untouchable here. */
  async revokeGrantedLicense(
    email: string,
    bookId: string,
    targetName: string,
    bookTitle: string,
  ): Promise<boolean> {
    const correlationId = newCorrelationId();
    const fn = httpsCallable<
      { email: string; bookId: string; correlationId: string },
      { removed: boolean }
    >(this.functions, 'revokeAdminGrantedLicense');
    let result;
    try {
      result = await fn({ email, bookId, correlationId });
    } catch (err) {
      throw attachCorrelationId(err, correlationId);
    }
    if (result.data.removed) {
      await this.activityLog.log('library_user_license_revoked', {
        targetName,
        detail: bookTitle,
      });
    }
    return result.data.removed;
  }

  /** Sends an announcement (sendLibraryUserMessage Cloud Function): inbox
   *  doc per recipient + device push + one adminMessages history summary. */
  async sendMessage(
    recipients: string[] | 'all',
    title: string,
    body: string,
  ): Promise<{ messageId: string; recipientCount: number; pushSuccessCount: number }> {
    const correlationId = newCorrelationId();
    const fn = httpsCallable<
      { recipients: string[] | 'all'; title: string; body: string; correlationId: string },
      { messageId: string; recipientCount: number; pushSuccessCount: number }
    >(this.functions, 'sendLibraryUserMessage');
    let result;
    try {
      result = await fn({ recipients, title, body, correlationId });
    } catch (err) {
      throw attachCorrelationId(err, correlationId);
    }
    await this.activityLog.log('admin_message_sent', {
      targetName:
        recipients === 'all'
          ? 'All library users'
          : `${result.data.recipientCount} selected user(s)`,
      detail: title,
    });
    return result.data;
  }
}
