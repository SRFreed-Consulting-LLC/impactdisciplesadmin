import { Injectable, Injector, runInInjectionContext } from '@angular/core';
import { addDoc, collectionData, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, startAfter, where } from '@angular/fire/firestore';
import { Firestore, collection } from '@angular/fire/firestore';
import { Observable, of, timer } from 'rxjs';
import { catchError, map, retry } from 'rxjs/operators';
import { DocumentData, onSnapshot, OrderByDirection, QueryConstraint, QueryDocumentSnapshot, QuerySnapshot } from 'firebase/firestore';
import { BaseModel } from '../models/base.model';
import { Unsubscribe } from 'firebase/auth';

// One page of a getPage() call. cursor is the raw QueryDocumentSnapshot for
// the last row in this page - pass it back into the next getPage() call's
// `cursor` param to fetch the next page (Firestore's own startAfter()
// cursor, not an offset - offset-based paging re-reads every prior page on
// each call, which is exactly the read-volume problem this exists to avoid).
export interface PagedResult<T> {
  items: T[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

// Live-diagnosed: attaching several onSnapshot listeners in the same tick
// (e.g. a component's ngOnInit firing off streamAll() for half a dozen
// collections at once) can spuriously fail a subset of the very first batch
// with a FirebaseError the SDK labels 'permission-denied' - actually a
// WebChannel handshake race on the freshly-opened connection, not a real
// rules rejection (confirmed live: rules allow the read, and re-subscribing
// to the exact same query outside that initial burst succeeds every time).
// A fixed short retry delay isn't enough on its own: every listener caught
// in the same collision retries on the same clock, so they just collide
// again. Randomized, growing-with-attempt-count jitter spreads the retries
// out so they stop landing in lockstep.
//
// Widened from an original 4-attempt/~400ms-per-step curve after a live
// refresh into Store Manager > Fulfillment still exhausted all 4 attempts
// (several components' listeners cold-starting at once, on top of whatever
// the browser itself is doing setting up its very first WebChannel
// connection of the page) - 4 attempts topping out around ~2.5s wasn't
// always enough. 6 attempts reaching further out trades a slightly longer
// worst-case recovery for meaningfully fewer total failures; this only
// costs anything in the rare collision case - a normal load never retries
// at all.
//
// Exported - FireAuthDao.loggedInUser$ hits the exact same race on a cold
// page load (several components' streamAll() calls plus its own one-time
// getAllByValue() all firing in the same tick) and needs the identical
// treatment; see that file's own comment for why it didn't have this until
// e2e testing this session's left-nav work reproduced it live.
export function retryDelay(_error: unknown, retryCount: number) {
  return timer(retryCount * 500 + Math.random() * 1200);
}

export const FIRESTORE_RETRY_COUNT = 6;

// Promise-flavored equivalent of retryDelay()/retry({count:4, delay:
// retryDelay}) above, for the one-time getDocs() reads (getAll/getAllByValue/
// queryByValue/queryAllByMultiValue/getPage) that had no retry at all until
// now - live-diagnosed as the missing half of the same cold-load race: a
// hard page load fires several components' worth of these one-time reads
// (e.g. a paginated list's first getPage() call) in the same tick as every
// streamAll() subscription, so they're just as exposed to the WebChannel
// handshake collision, but unlike streamAll()/loggedInUser$ they had no
// resilience against it - a single unlucky tick left the screen (e.g.
// Products right after a refresh) rendering nothing, with no retry and no
// visible error.
//
// Takes an Injector and re-enters it via runInInjectionContext() on every
// attempt - AngularFire's modular functions (getDocs() included) assert
// they're being called within an Angular injection context and warn
// ("Calling Firebase APIs outside of an Injection context") otherwise. The
// `await new Promise(setTimeout)` delay between retries crosses an async
// boundary Angular doesn't track, so a bare retried getDocs() call loses
// that context even though the very first attempt (called synchronously
// from wherever this DAO method was invoked) usually still has it.
async function retryGetDocs<T>(injector: Injector, fn: () => Promise<T>, retriesLeft = FIRESTORE_RETRY_COUNT): Promise<T> {
  try {
    return await runInInjectionContext(injector, fn);
  } catch (err) {
    if (retriesLeft <= 0) {
      throw err;
    }
    const attempt = FIRESTORE_RETRY_COUNT + 1 - retriesLeft;
    const delayMs = attempt * 500 + Math.random() * 1200;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return retryGetDocs(injector, fn, retriesLeft - 1);
  }
}

@Injectable({
  providedIn: 'root'
})
export class FirebaseDAO<T extends BaseModel> {

  // Injector kept only for retryGetDocs() - see its own comment on why a
  // retried getDocs() call needs to explicitly re-enter injection context.
  constructor(public fs: Firestore, private injector: Injector) {}

  // limitCount is optional and defaults to unbounded (existing behavior) --
  // pass it to cap how many documents a page pulls back instead of the
  // entire collection.
  public getAll(table: string, fromFirestore?, limitCount?: number): Promise<T[]>{
    const constraints: QueryConstraint[] = limitCount ? [limit(limitCount)] : [];

    return retryGetDocs(this.injector, () => getDocs(query(collection(this.fs, '/' + table), ...constraints))).then(docs => {
      return this.getDocListFromPromise(docs, fromFirestore);
    });
  }

  public getAllByValue(table: string, field: string, value: any, fromFirestore?, limitCount?: number): Promise<T[]>{
    const constraints: QueryConstraint[] = [where(field, "==", value)];
    if (limitCount) constraints.push(limit(limitCount));

    return retryGetDocs(this.injector, () => getDocs(query(collection(this.fs, '/' + table), ...constraints))).then(docs => {
      return this.getDocListFromPromise(docs, fromFirestore);
    });
  }

  public queryByValue(table: string, field: string, opStr: WhereFilterOperandKeys, value: any, fromFirestore?, limitCount?: number): Promise<T[]>{
    const constraints: QueryConstraint[] = [where(field, opStr, value)];
    if (limitCount) constraints.push(limit(limitCount));

    return retryGetDocs(this.injector, () => getDocs(query(collection(this.fs, '/' + table), ...constraints))).then(docs => {
      return this.getDocListFromPromise(docs, fromFirestore);
    });
  }

  public queryAllByMultiValue(table: string, queries: QueryParam[], fromFirestore?, limitCount?: number): Promise<T[]>{
    const queryConstraints: QueryConstraint[] = queries.map((query) =>
      where(query.field, query.operation, query.value),
    );
    if (limitCount) queryConstraints.push(limit(limitCount));

    return retryGetDocs(this.injector, () => getDocs(query(collection(this.fs, '/' + table), ...queryConstraints))).then(docs => {
      return this.getDocListFromPromise(docs, fromFirestore);
    });
  }

  // One-time (not live) fetch of a single page, ordered by orderByField, cursoring
  // via startAfter(cursor) rather than an offset. Used by list screens with large
  // collections (e.g. Products, Customers, Log Messages) instead of streamAll()'s
  // "subscribe to the entire collection forever" - see PagedCollectionSource for
  // the client-side accumulator this is meant to be driven by.
  public async getPage(
    table: string,
    pageSize: number,
    cursor: QueryDocumentSnapshot<DocumentData> | null,
    orderByField: string,
    orderDirection: OrderByDirection = 'asc',
    fromFirestore?
  ): Promise<PagedResult<T>> {
    const constraints: QueryConstraint[] = [orderBy(orderByField, orderDirection)];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(pageSize));

    const snap = await retryGetDocs(this.injector, () => getDocs(query(collection(this.fs, '/' + table), ...constraints)));
    const items = this.getDocListFromPromise(snap, fromFirestore);
    const lastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;

    return {
      items,
      cursor: lastDoc,
      // Exactly pageSize docs came back -> there's likely a next page.
      // Fewer than pageSize -> this was the tail of the collection.
      hasMore: snap.docs.length === pageSize
    };
  }

  public getById(id: string, table: string, fromFirestore?): Promise<T>{
    return getDoc(doc(this.fs, '/' + table + '/' + id)).then(async doc => {
      if(doc.exists()){
        const retval: T = doc.data() as T;
        retval.id = doc.id;
        return fromFirestore? fromFirestore(retval) : retval;
      }
    })
  }

  public add(value: T, table: string, fromFirestore?): Promise<T>{
    return addDoc(collection(this.fs, '/' + table), value).then(async doc => {
      const retval = await this.getById(doc.id, table, fromFirestore);
      retval.id = doc.id;
      return retval;
    });
  }

  public async update(id: string, value: T, table: string, fromFirestore?): Promise<T>{
    await setDoc(doc(this.fs, '/' + table + '/' + id), value).then(async () => {
      const retval = await this.getById(id, table, fromFirestore);
      retval.id = id;
      return retval;
    });

    return this.getById(id, table, fromFirestore);
  }

  public delete(id: string, table: string){
    return deleteDoc(doc(this.fs, '/' + table + '/' + id));
  }

  // onError is optional and purely a side-channel signal - the returned
  // Observable's own contract (Observable<T[]>, never itself erroring)
  // doesn't change, so every existing call site is unaffected. Callers that
  // want to distinguish "genuinely empty" from "failed to load" (the
  // catchError fallback below is otherwise indistinguishable from a real
  // empty collection) can pass one; see FulfillmentComponent for the
  // reference usage. IMPORTANT for callers that do: once this fires, the
  // returned Observable has already fallen back to of([]), which completes
  // - the live listener is gone, not paused, so recovering means calling
  // streamAll() again fresh (a brand new subscription), not waiting on this
  // one.
  public streamAll(table: string, fromFirestore?, limitCount?: number, onError?: (err: unknown) => void): Observable<T[]>{
    const constraints: QueryConstraint[] = limitCount ? [limit(limitCount)] : [];

    return collectionData(query(collection(this.fs, '/' + table), ...constraints), {idField: 'id'}).pipe(
      map(docs => {
        return this.getDocListFromStream(docs, fromFirestore);
      }),
      // See retryDelay()'s comment at the top of this file.
      retry({ count: FIRESTORE_RETRY_COUNT, delay: retryDelay }),
      // Without this, a failure that survives the retries above just errors
      // the observable silently -- no error callback is registered at most
      // call sites, so the UI is left showing stale/empty data forever with
      // no visible sign anything went wrong. Log it and fall back to an
      // empty list instead.
      catchError(err => {
        console.error(`FirebaseDAO.streamAll('${table}') failed:`, err);
        onError?.(err);
        return of([]);
      })
    );
  }

  public streamByValue(table: string, field: string, value: any, fromFirestore?, limitCount?: number): Observable<T[]>{
    const constraints: QueryConstraint[] = [where(field, "==", value)];
    if (limitCount) constraints.push(limit(limitCount));

    return collectionData(query(collection(this.fs, '/' + table), ...constraints), {idField: 'id'}).pipe(
      map(docs => {
        return this.getDocListFromStream(docs, fromFirestore);
      }),
      // See streamAll()'s comment above - same spurious-first-batch issue.
      retry({ count: FIRESTORE_RETRY_COUNT, delay: retryDelay }),
      catchError(err => {
        console.error(`FirebaseDAO.streamByValue('${table}', '${field}') failed:`, err);
        return of([]);
      })
    );
  }

  public streamById(id: string, table: string, callBack, fromFirestore?): Unsubscribe{
    return onSnapshot(doc(this.fs, '/' + table + '/' + id), async doc => {
      if(doc.exists()){
        let retval: T = doc.data() as T;
        retval.id = doc.id;
        retval = fromFirestore? fromFirestore(retval) : retval;
        callBack(retval);
      }
    })
  }

  public queryStreamByValue(table: string, field: string, opStr: WhereFilterOperandKeys, value: any, fromFirestore?, limitCount?: number): Observable<T[]>{
    const constraints: QueryConstraint[] = [where(field, opStr, value)];
    if (limitCount) constraints.push(limit(limitCount));

    return collectionData(query(collection(this.fs, '/' + table), ...constraints), {idField: 'id'}).pipe(
      map(docs => {
        return this.getDocListFromStream(docs, fromFirestore);
      }),
      // See streamAll()'s comment in this file - same spurious-first-batch issue.
      retry({ count: FIRESTORE_RETRY_COUNT, delay: retryDelay }),
      catchError(err => {
        console.error(`FirebaseDAO.queryStreamByValue('${table}', '${field}') failed:`, err);
        return of([]);
      })
    );
  }

  public queryAllStreamByMultiValue(table: string, queries: QueryParam[], fromFirestore?, limitCount?: number): Observable<T[]>{
    const queryConstraints: QueryConstraint[] = queries.map((query) =>
      where(query.field, query.operation, query.value),
    );
    if (limitCount) queryConstraints.push(limit(limitCount));

    return collectionData(query(collection(this.fs, '/' + table), ...queryConstraints), {idField: 'id'}).pipe(
      map(docs => {
        return this.getDocListFromStream(docs, fromFirestore);
      }),
      // See streamAll()'s comment in this file - same spurious-first-batch issue.
      retry({ count: FIRESTORE_RETRY_COUNT, delay: retryDelay }),
      catchError(err => {
        console.error(`FirebaseDAO.queryAllStreamByMultiValue('${table}') failed:`, err);
        return of([]);
      })
    );
  }

  public async createInSubcollection(value: T, table: string, record_id: string, subcollection: string, fromFirestore?): Promise<T> {
    const snap = await addDoc(collection(this.fs, table, record_id, subcollection), value);

    return this.getById(table, snap.id, fromFirestore);
  }

  public async getAllFromSubCollection(table: string, record_id: string, subcollection: string, fromFirestore?): Promise<T[]> {
    const snap = await getDocs(collection(this.fs, table, record_id, subcollection));

    const docsData = snap.docs.map((item) => (item.exists() ? item.data() as T : null));

    return docsData;
  }

  private getDocListFromStream(docs: (DocumentData | (DocumentData & {id: string}))[], fromFirestore){
    const retval: T[] = [];

    docs.forEach(doc => {
      const val: T = doc as T;
      val.id = doc.id;
      retval.push(fromFirestore? fromFirestore(val) :val);
    })

    return retval;
  }

  private getDocListFromPromise(docs: QuerySnapshot<DocumentData, DocumentData>, fromFirestore){
    const retval: T[] = [];

    docs.forEach(doc => {
      const val: T = doc.data() as T;
      val.id = doc.id;
      retval.push(fromFirestore? fromFirestore(val) :val);
    })

    return retval;
  }

  private getDoc(doc: (DocumentData | (DocumentData & {id: string})), fromFirestore){
    const val: T = doc as T;
    val.id = doc.id;
    return fromFirestore? fromFirestore(val) : val;
  }
}




export enum WhereFilterOperandKeys {
  less = '<',
  lessOrEqual = '<=',
  equal = '==',
  notEqual = '!=',
  more = '>',
  moreOrEqual = '>=',
  arrayContains = 'array-contains',
  in = 'in',
  arrayContainsAny = 'array-contains-any',
  notIn = 'not-in',
}

export class QueryParam {
  constructor(field: string, operation: WhereFilterOperandKeys, value: any) {
    this.field = field;
    this.operation = operation;
    this.value = value;
  }
  field: string;
  value: any;
  operation: WhereFilterOperandKeys;
}
