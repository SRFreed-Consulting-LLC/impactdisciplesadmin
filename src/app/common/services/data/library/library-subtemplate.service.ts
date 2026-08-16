import { Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { BaseService } from '../base.service';
import { LibrarySubtemplateModel } from 'src/app/common/models/domain/library/library-subtemplate.model';
import { libraryFirestoreDAO } from './library-firestore.util';

// Reads the `subtemplates` collection in the named 'impactdiscipleship-books'
// database - see library-firestore.util.ts's own comment for why this MUST
// construct its DAO through that factory rather than injecting the shared
// one. Read-only for now (getAll/getById inherited from BaseService cover
// everything Slice 2's Lesson Editor needs) - create/save/delete arrive with
// the Subtemplate Editor's own later slice.
@Injectable({
  providedIn: 'root'
})
export class LibrarySubtemplateService extends BaseService<LibrarySubtemplateModel> {
  constructor(app: FirebaseApp) {
    super(libraryFirestoreDAO<LibrarySubtemplateModel>(app));
    this.table = 'subtemplates';
  }
}
