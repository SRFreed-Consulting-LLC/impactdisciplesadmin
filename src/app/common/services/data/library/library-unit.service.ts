import { Injectable } from '@angular/core';
import {
  Firestore,
  QueryDocumentSnapshot,
  collectionGroup,
  getDocs,
} from '@angular/fire/firestore';
import { LibraryUnitModel } from 'src/app/common/models/domain/library/library-unit.model';
import { parseUnitPath } from './library-nested-path.util';

// Reads the `units` subcollection nested under
// `librarySeries/{seriesId}/books/{bookId}` in THIS app's own default
// database (Phase 3 migration target) - see library-nested-path.util.ts's
// own comment on why `bookId` stays a field on LibraryUnitModel (populated
// from the doc's own path at read time) even though it's no longer stored
// in Firestore itself.
//
// Only getById()/getByBook() are implemented - confirmed via a full grep
// of every Library screen that no create/update/delete call on this
// service exists anywhere.
@Injectable({
  providedIn: 'root'
})
export class LibraryUnitService {
  constructor(private firestore: Firestore) {}

  private fromDoc(d: QueryDocumentSnapshot): LibraryUnitModel {
    const { bookId } = parseUnitPath(d.ref);
    return { id: d.id, bookId, ...d.data() } as LibraryUnitModel;
  }

  /** A unit id alone doesn't say which book it's nested under - scans
   *  every book's `units` subcollection via a collectionGroup query and
   *  matches by the doc's own id. Fine at this library's real scale (33
   *  units total). */
  async getById(id: string): Promise<LibraryUnitModel | undefined> {
    const snap = await getDocs(collectionGroup(this.firestore, 'units'));
    const found = snap.docs.find((d) => d.id === id);
    return found ? this.fromDoc(found) : undefined;
  }

  getByBook(bookId: string): Promise<LibraryUnitModel[]> {
    // bookId alone doesn't say which series the book is under either, so
    // this still needs a collectionGroup scan (unlike LibraryBookService's
    // own getBySeries, which has a full direct path available) - filtered
    // by the book id once found, not a direct collection() read.
    return getDocs(collectionGroup(this.firestore, 'units')).then((snap) =>
      snap.docs
        .filter((d) => d.ref.parent.parent?.id === bookId)
        .map((d) => this.fromDoc(d)),
    );
  }
}
