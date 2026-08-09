import { inject, Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { getFirestore } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { BookModel } from 'src/app/common/models/domain/book.model';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class BookService extends BaseService<BookModel> {
  constructor(public override dao: FirebaseDAO<BookModel>) {
    super(dao)
    this.table = "books"

    // Book/Unit/Lesson data lives in a separate named Firestore database
    // ("impactdiscipleship-books"), not the app's default database - every
    // other service in this file's own BaseService uses the injected
    // (default) Firestore instance, so this override is intentionally
    // local to BookService rather than made part of the shared BaseService.
    // Ported from impactdisciplespwacommon's BaseService, which every
    // service in that submodule relied on for this same override.
    dao.fs = getFirestore(inject(FirebaseApp), "impactdiscipleship-books")
  }
}
