import { Injectable } from '@angular/core';
import {
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
// Only getAll()/getById()/getBySeries() are implemented - confirmed via a
// full grep of every Library screen that no create/update/delete call on
// this service exists anywhere.
@Injectable({
  providedIn: 'root'
})
export class LibraryBookService {
  constructor(private firestore: Firestore) {}

  private fromDoc(d: QueryDocumentSnapshot): LibraryBookModel {
    const { seriesId } = parseBookPath(d.ref);
    return { id: d.id, seriesId, ...d.data() } as LibraryBookModel;
  }

  /** Every book across every series - `collectionGroup` reads every
   *  `books` subcollection at once regardless of parent. Used by screens
   *  that need a flat book-title lookup (e.g. Groups admin's book
   *  picker) without already knowing which series each book belongs to. */
  async getAll(): Promise<LibraryBookModel[]> {
    const snap = await getDocs(collectionGroup(this.firestore, 'books'));
    return snap.docs.map((d) => this.fromDoc(d));
  }

  /** A book id alone doesn't say which series it's nested under - unlike
   *  getBySeries below (used when drilling DOWN from an already-known
   *  series), this is for drilling UP from just a book id (e.g. a
   *  lesson's hydrated `bookId`), so it has to scan every series' `books`
   *  subcollection via a collectionGroup query and match by the doc's own
   *  id. Fine at this library's real scale (a handful of books total) -
   *  see the Phase 3 memory notes if this ever needs a real index instead. */
  async getById(id: string): Promise<LibraryBookModel | undefined> {
    const snap = await getDocs(collectionGroup(this.firestore, 'books'));
    const found = snap.docs.find((d) => d.id === id);
    return found ? this.fromDoc(found) : undefined;
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
