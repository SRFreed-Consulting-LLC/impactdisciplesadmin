import { Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { BaseService } from '../base.service';
import { LibraryBookModel } from 'src/app/common/models/domain/library/library-book.model';
import { libraryFirestoreDAO } from './library-firestore.util';

// Reads/writes the `books` collection in the named 'impactdiscipleship-books'
// database - see library-firestore.util.ts's own comment for why this MUST
// construct its DAO through that factory rather than injecting the shared
// one. Named LibraryBookService, not BookService - see LibraryBookModel's
// own comment on the pre-existing, differently-shaped BookService/BookModel
// this deliberately avoids colliding with.
@Injectable({
  providedIn: 'root'
})
export class LibraryBookService extends BaseService<LibraryBookModel> {
  constructor(app: FirebaseApp) {
    super(libraryFirestoreDAO<LibraryBookModel>(app));
    this.table = 'books';
  }

  getBySeries(seriesId: string): Promise<LibraryBookModel[]> {
    return this.getAllByValue('seriesId', seriesId);
  }
}
