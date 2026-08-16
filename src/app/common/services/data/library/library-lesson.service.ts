import { Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { BaseService } from '../base.service';
import { LibraryLessonModel } from 'src/app/common/models/domain/library/library-lesson.model';
import { libraryFirestoreDAO } from './library-firestore.util';

// Reads/writes the `lessons` collection in the named 'impactdiscipleship-books'
// database - see library-firestore.util.ts's own comment for why this MUST
// construct its DAO through that factory rather than injecting the shared one.
@Injectable({
  providedIn: 'root'
})
export class LibraryLessonService extends BaseService<LibraryLessonModel> {
  constructor(app: FirebaseApp) {
    super(libraryFirestoreDAO<LibraryLessonModel>(app));
    this.table = 'lessons';
  }

  getByUnit(unitId: string): Promise<LibraryLessonModel[]> {
    return this.getAllByValue('unitId', unitId);
  }
}
