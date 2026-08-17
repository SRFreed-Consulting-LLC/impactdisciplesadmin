import { Injectable } from '@angular/core';
import { Firestore, collection, doc, getDoc, getDocs } from '@angular/fire/firestore';
import { BookSeriesModel } from 'src/app/common/models/domain/library/book-series.model';

// Reads the `librarySeries` collection in THIS app's own default database
// (Phase 3 migration target) - a real top-level collection, not nested
// under anything, so this is a plain injected-Firestore service like any
// other in this app; no more "own DAO instance" workaround needed (that
// existed only for the old named-database cross-database concern, which
// doesn't apply here any more). Named `librarySeries`, not `series` - this
// app's own Store Manager already has an unrelated top-level `series`
// collection (Product Series) that a bare `series` name would collide
// with; see the Phase 3 migration scripts' own comments.
//
// Only getAll()/getById() are implemented - confirmed via a full grep of
// every Library screen that no create/update/delete call on this service
// exists anywhere (series-level CRUD was never part of what Phase 2
// ported).
@Injectable({
  providedIn: 'root'
})
export class BookSeriesService {
  constructor(private firestore: Firestore) {}

  private collectionRef() {
    return collection(this.firestore, 'librarySeries');
  }

  async getAll(): Promise<BookSeriesModel[]> {
    const snap = await getDocs(this.collectionRef());
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BookSeriesModel);
  }

  async getById(id: string): Promise<BookSeriesModel | undefined> {
    const snap = await getDoc(doc(this.firestore, 'librarySeries', id));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as BookSeriesModel) : undefined;
  }
}
