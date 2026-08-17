import { Injectable } from '@angular/core';
import {
  DocumentReference,
  Firestore,
  QueryDocumentSnapshot,
  collection,
  collectionGroup,
  getDoc,
  getDocs,
} from '@angular/fire/firestore';
import { LibraryUnitModel } from 'src/app/common/models/domain/library/library-unit.model';
import { parseUnitPath } from './library-nested-path.util';
import { LibraryBookService } from './library-book.service';

// Reads the `units` subcollection nested under
// `librarySeries/{seriesId}/books/{bookId}` in THIS app's own default
// database (Phase 3 migration target) - see library-nested-path.util.ts's
// own comment on why `bookId` stays a field on LibraryUnitModel (populated
// from the doc's own path at read time) even though it's no longer stored
// in Firestore itself.
//
// Only getById()/getByBook() (plus the refById() ref-resolution helper) are
// implemented - confirmed via a full grep of every Library screen that no
// create/update/delete call on this service exists anywhere. The one writer
// into the librarySeries tree is LibraryImportBookService, which calls
// invalidateRefs() after creating docs - see the ref-memo comment on
// unitRefs() below.
@Injectable({
  providedIn: 'root'
})
export class LibraryUnitService {
  /** Lazily-built shared id -> DocumentReference map over every `units`
   *  subcollection. See unitRefs() for the memoization contract. */
  private refsPromise: Promise<Map<string, DocumentReference>> | null = null;

  constructor(
    private firestore: Firestore,
    private books: LibraryBookService,
  ) {}

  private fromDoc(d: QueryDocumentSnapshot): LibraryUnitModel {
    const { bookId } = parseUnitPath(d.ref);
    return { id: d.id, bookId, ...d.data() } as LibraryUnitModel;
  }

  /** The one collectionGroup('units') scan this service runs - AT MOST once
   *  per app session (or once per invalidateRefs()). It exists only to
   *  resolve a bare unit id to its full nested DocumentReference; document
   *  DATA is never served from this memo (content edits don't move docs, so
   *  a cached REFERENCE can't go stale the way cached data would) -
   *  getById() always follows up with a fresh getDoc(). A failed scan is
   *  never memoized, so a transient offline/permission error doesn't poison
   *  the whole session. */
  private unitRefs(): Promise<Map<string, DocumentReference>> {
    if (!this.refsPromise) {
      const scan = getDocs(collectionGroup(this.firestore, 'units')).then(
        (snap) => new Map<string, DocumentReference>(snap.docs.map((d) => [d.id, d.ref])),
      );
      scan.catch(() => {
        if (this.refsPromise === scan) {
          this.refsPromise = null;
        }
      });
      this.refsPromise = scan;
    }
    return this.refsPromise;
  }

  /** Forget the memoized id -> ref map so the next lookup re-scans. Must be
   *  called after any operation that creates, deletes, or moves docs in the
   *  librarySeries tree (currently only LibraryImportBookService). */
  invalidateRefs(): void {
    this.refsPromise = null;
  }

  /** Resolve a bare unit id to its full nested DocumentReference via the
   *  memoized map - also used by LibraryLessonService.getByUnit() to
   *  address a unit's `lessons` subcollection directly. */
  async refById(id: string): Promise<DocumentReference | undefined> {
    return (await this.unitRefs()).get(id);
  }

  /** A unit id alone doesn't say which book it's nested under - resolves
   *  the ref via the memoized id -> ref map (one collectionGroup scan per
   *  session, not per call), then fetches the doc's CONTENT fresh with
   *  getDoc(). */
  async getById(id: string): Promise<LibraryUnitModel | undefined> {
    const ref = await this.refById(id);
    if (!ref) {
      return undefined;
    }
    const snap = await getDoc(ref);
    return snap.exists() ? this.fromDoc(snap) : undefined;
  }

  /** bookId alone doesn't say which series the book is under either, so
   *  this first resolves the book's own DocumentReference via
   *  LibraryBookService's memoized id -> ref map, then issues a fresh,
   *  cheap nested getDocs() on just that book's `units` subcollection -
   *  no per-call collectionGroup scan. An unknown bookId returns [] (same
   *  as the old scan-and-filter behavior). */
  async getByBook(bookId: string): Promise<LibraryUnitModel[]> {
    const bookRef = await this.books.refById(bookId);
    if (!bookRef) {
      return [];
    }
    const snap = await getDocs(collection(bookRef, 'units'));
    return snap.docs.map((d) => this.fromDoc(d));
  }
}
