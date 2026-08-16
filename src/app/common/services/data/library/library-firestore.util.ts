import { FirebaseApp } from '@angular/fire/app';
import { getFirestore } from '@angular/fire/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { BaseModel } from 'src/app/common/models/base.model';

/**
 * Every Library service (BookSeriesService, LibraryBookService,
 * LibraryUnitService, LibraryLessonService, ...) must construct its DAO
 * through this, never by injecting the shared `FirebaseDAO` singleton
 * directly and repointing its `.fs`.
 *
 * CRITICAL, learned the hard way (see book.service.ts's own comment,
 * live-confirmed via Playwright network capture 2026-08-09): `FirebaseDAO`
 * is `providedIn: 'root'`, and Angular DI does not create a separate
 * instance per generic type parameter - the injected `FirebaseDAO<T>` is
 * the exact same singleton object every other service in this app uses for
 * the DEFAULT database. Setting `.fs` on that shared instance to point at
 * the named 'impactdiscipleship-books' database silently repoints the
 * ENTIRE APP at it the moment the first Library service is constructed,
 * breaking every other screen's reads/writes with "Missing or insufficient
 * permissions" (that database's own, unrelated rules apply) or silent empty
 * results. This factory builds a brand-new `FirebaseDAO` instance instead -
 * own object, own `.fs`, never touches the shared singleton at all.
 */
export function libraryFirestoreDAO<T extends BaseModel>(app: FirebaseApp): FirebaseDAO<T> {
  return new FirebaseDAO<T>(getFirestore(app, 'impactdiscipleship-books'));
}
