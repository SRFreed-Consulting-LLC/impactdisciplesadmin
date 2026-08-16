import { Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { BaseService } from '../base.service';
import { LibraryUnitModel } from 'src/app/common/models/domain/library/library-unit.model';
import { libraryFirestoreDAO } from './library-firestore.util';

// Reads/writes the `units` collection in the named 'impactdiscipleship-books'
// database - see library-firestore.util.ts's own comment for why this MUST
// construct its DAO through that factory rather than injecting the shared one.
@Injectable({
  providedIn: 'root'
})
export class LibraryUnitService extends BaseService<LibraryUnitModel> {
  constructor(app: FirebaseApp) {
    super(libraryFirestoreDAO<LibraryUnitModel>(app));
    this.table = 'units';
  }

  getByBook(bookId: string): Promise<LibraryUnitModel[]> {
    return this.getAllByValue('bookId', bookId);
  }
}
