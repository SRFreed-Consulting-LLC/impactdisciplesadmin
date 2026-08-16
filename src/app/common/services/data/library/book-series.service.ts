import { Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { BaseService } from '../base.service';
import { BookSeriesModel } from 'src/app/common/models/domain/library/book-series.model';
import { libraryFirestoreDAO } from './library-firestore.util';

// Reads/writes the `series` collection in the named 'impactdiscipleship-books'
// database - see library-firestore.util.ts's own comment for why this MUST
// construct its DAO through that factory rather than injecting the shared one.
@Injectable({
  providedIn: 'root'
})
export class BookSeriesService extends BaseService<BookSeriesModel> {
  constructor(app: FirebaseApp) {
    super(libraryFirestoreDAO<BookSeriesModel>(app));
    this.table = 'series';
  }
}
