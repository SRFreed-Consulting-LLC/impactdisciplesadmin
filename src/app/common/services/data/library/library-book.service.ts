import { Injectable } from '@angular/core';
import {
  DocumentReference,
  Firestore,
  QueryDocumentSnapshot,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
} from '@angular/fire/firestore';
import { LibraryBookModel } from 'src/app/common/models/domain/library/library-book.model';
import { parseBookPath } from './library-nested-path.util';

// Reads the `books` subcollection nested under `librarySeries/{seriesId}`
// in THIS app's own default database (Phase 3 migration target) - see
// library-nested-path.util.ts's own comment on why `seriesId` stays a
// field on LibraryBookModel (populated from the doc's own path at read
// time) even though it's no longer stored in Firestore itself. Named
// LibraryBookService, not BookService - see LibraryBookModel's own comment
// on the pre-existing, differently-shaped BookService/BookModel this
// deliberately avoids colliding with.
//
// Only getAll()/getById()/getBySeries()/getByIdInSeries() (plus the
// refById() ref-resolution helper) are implemented - confirmed via a full
// grep of every Library screen that no create/update/delete call on this
// service exists anywhere. The one writer into the librarySeries tree is
// LibraryImportBookService, which calls invalidateRefs() after creating
// docs - see the ref-memo comment on bookRefs() below.
@Injectable({
  providedIn: 'root'
})
export class LibraryBookService {
  /** Lazily-built shared id -> DocumentReference map over every `books`
   *  subcollection. See bookRefs() for the memoization contract. */
  private refsPromise: Promise<Map<string, DocumentReference>> | null = null;

  constructor(private firestore: Firestore) {}

  private fromDoc(d: QueryDocumentSnapshot): LibraryBookModel {
    const { seriesId } = parseBookPath(d.ref);
    return { id: d.id, seriesId, ...d.data() } as LibraryBookModel;
  }

  /** The one collectionGroup('books') scan this service runs - AT MOST once
   *  per app session (or once per invalidateRefs(), see below). It exists
   *  only to resolve a bare book id to its full nested DocumentReference;
   *  document DATA is never served from this memo (content edits don't move
   *  docs, so a cached REFERENCE can't go stale the way cached data would) -
   *  getById() always follows up with a fresh getDoc(). A failed scan is
   *  never memoized, so a transient offline/permission error doesn't poison
   *  the whole session. */
  private bookRefs(): Promise<Map<string, DocumentReference>> {
    if (!this.refsPromise) {
      const scan = getDocs(collectionGroup(this.firestore, 'books')).then(
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

  /** Resolve a bare book id to its full nested DocumentReference via the
   *  memoized map - also used by LibraryUnitService.getByBook() to address
   *  a book's `units` subcollection directly. */
  async refById(id: string): Promise<DocumentReference | undefined> {
    return (await this.bookRefs()).get(id);
  }

  /** Every book across every series - `collectionGroup` reads every
   *  `books` subcollection at once regardless of parent. Used by screens
   *  that need a flat book-title lookup (e.g. Groups admin's book
   *  picker) without already knowing which series each book belongs to.
   *  Since this is already a full fresh scan, it also refreshes the
   *  memoized id -> ref map as a free by-product. */
  async getAll(): Promise<LibraryBookModel[]> {
    const snap = await getDocs(collectionGroup(this.firestore, 'books'));
    this.refsPromise = Promise.resolve(
      new Map<string, DocumentReference>(snap.docs.map((d) => [d.id, d.ref])),
    );
    return snap.docs.map((d) => this.fromDoc(d));
  }

  /** A book id alone doesn't say which series it's nested under - unlike
   *  getBySeries below (used when drilling DOWN from an already-known
   *  series), this is for drilling UP from just a book id (e.g. a
   *  lesson's hydrated `bookId`). Resolves the ref via the memoized
   *  id -> ref map (one collectionGroup scan per session, not per call),
   *  then fetches the doc's CONTENT fresh with getDoc(). */
  async getById(id: string): Promise<LibraryBookModel | undefined> {
    const ref = await this.refById(id);
    if (!ref) {
      return undefined;
    }
    const snap = await getDoc(ref);
    return snap.exists() ? this.fromDoc(snap) : undefined;
  }

  getBySeries(seriesId: string): Promise<LibraryBookModel[]> {
    return getDocs(collection(this.firestore, 'librarySeries', seriesId, 'books')).then((snap) =>
      snap.docs.map((d) => ({ id: d.id, seriesId, ...d.data() }) as LibraryBookModel),
    );
  }

  /** Direct lookup when the parent seriesId is already known (e.g.
   *  resolved from a lesson/unit's own hydrated ancestor ids) - no
   *  collectionGroup scan needed, unlike the bare getById above. */
  async getByIdInSeries(seriesId: string, bookId: string): Promise<LibraryBookModel | undefined> {
    const snap = await getDoc(doc(this.firestore, 'librarySeries', seriesId, 'books', bookId));
    return snap.exists() ? ({ id: snap.id, seriesId, ...snap.data() } as LibraryBookModel) : undefined;
  }
}
