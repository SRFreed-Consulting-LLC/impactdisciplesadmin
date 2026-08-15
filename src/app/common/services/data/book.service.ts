import { Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { getFirestore } from '@angular/fire/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { BookModel } from 'src/app/common/models/domain/book.model';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class BookService extends BaseService<BookModel> {
  // Book/Unit/Lesson data lives in a separate named Firestore database
  // ("impactdiscipleship-books"), not the app's default database - ported
  // from impactdisciplespwacommon, whose BaseService relied on this same
  // override.
  //
  // CRITICAL: this service constructs its OWN FirebaseDAO rather than
  // injecting the shared one. FirebaseDAO is providedIn:'root', and Angular
  // DI does not create separate instances per generic type parameter - so
  // the injected FirebaseDAO<BookModel> is the exact same singleton object
  // every other service in the app uses. An earlier version of this class
  // did `dao.fs = getFirestore(app, 'impactdiscipleship-books')` on that
  // injected singleton, which silently repointed the ENTIRE APP at the
  // books database the moment BookService was first constructed (i.e. the
  // first time ProductsComponent rendered). That was the true root cause of
  // the long-standing "Missing or insufficient permissions" bursts +
  // empty-list results on hard refresh into /store-manager, misdiagnosed
  // for a long time as a WebChannel race: reads against the books database
  // are governed by THAT database's own (restrictive) rules, and
  // collections that don't exist there come back "successfully" empty.
  // Live-confirmed via Playwright network capture 2026-08-09 - the failing
  // Listen channels all carried database=...%2Fimpactdiscipleship-books.
  constructor(app: FirebaseApp) {
    super(new FirebaseDAO<BookModel>(getFirestore(app, 'impactdiscipleship-books')));
    this.table = 'books';
  }
}
