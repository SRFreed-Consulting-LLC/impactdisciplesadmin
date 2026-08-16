import { Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { collection, collectionData } from '@angular/fire/firestore';
import { Observable, map, shareReplay } from 'rxjs';
import { LibraryUser } from 'src/app/common/models/domain/library/library-user.model';
import { libraryFirestore } from './library-firestore.util';

/**
 * The `libraryUsers` collection - owned and written by the reader app
 * (impact-discipleship-library-new), read here via `libraryFirestore(app)`
 * (the named 'impactdiscipleship-books' database - see that factory's own
 * comment for why this MUST NOT go through the shared injected `Firestore`
 * instance).
 *
 * **Read-only subset for now** - ported from
 * impact-discipleship-library-manager-new's LibraryUserService just far
 * enough to back the World Map (Slice 4 part 2). The full Library Users
 * screen (list/detail, revoke, license grants, messaging) is a later part
 * of this same slice and needs its own ported Cloud Functions
 * (updateLibraryUser/setLibraryUserRevoked/grantLibraryUserLicenses/
 * revokeAdminGrantedLicense/sendLibraryUserMessage) - none of that is here
 * yet.
 */
@Injectable({ providedIn: 'root' })
export class LibraryUserService {
  constructor(private app: FirebaseApp) {}

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
    collectionData(collection(libraryFirestore(this.app), 'libraryUsers'), {
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
}
