import { Injectable } from '@angular/core';
import { addDoc, collectionData, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, startAfter, updateDoc, where } from '@angular/fire/firestore';
import { Firestore, collection } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
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

@Injectable({
  providedIn: 'root'
})
export class FirebaseDAO<T extends BaseModel> {

  constructor(public fs: Firestore) {}

  // limitCount is optional and defaults to unbounded (existing behavior) --
  // pass it to cap how many documents a page pulls back instead of the
  // entire collection.
  public getAll(table: string, fromFirestore?, limitCount?: number): Promise<T[]>{
    const constraints: QueryConstraint[] = limitCount ? [limit(limitCount)] : [];

    return getDocs(query(collection(this.fs, '/' + table), ...constraints)).then(docs => {
      return this.getDocListFromPromise(docs, fromFirestore);
    });
  }

  public getAllByValue(table: string, field: string, value: unknown, fromFirestore?, limitCount?: number): Promise<T[]>{
    const constraints: QueryConstraint[] = [where(field, "==", value)];
    if (limitCount) constraints.push(limit(limitCount));

    return getDocs(query(collection(this.fs, '/' + table), ...constraints)).then(docs => {
      return this.getDocListFromPromise(docs, fromFirestore);
    });
  }

  public queryAllByMultiValue(table: string, queries: QueryParam[], fromFirestore?, limitCount?: number): Promise<T[]>{
    const queryConstraints: QueryConstraint[] = queries.map((query) =>
      where(query.field, query.operation, query.value),
    );
    if (limitCount) queryConstraints.push(limit(limitCount));

    return getDocs(query(collection(this.fs, '/' + table), ...queryConstraints)).then(docs => {
      return this.getDocListFromPromise(docs, fromFirestore);
    });
  }

  // One-time (not live) fetch of a single page, ordered by orderByField, cursoring
  // via startAfter(cursor) rather than an offset. Used by list screens with large
  // collections (e.g. Products, Customers, Log Messages) instead of streamAll()'s
  // "subscribe to the entire collection forever" - see PagedCollectionSource for
  // the client-side accumulator this is meant to be driven by.
  // `filters` (optional) prepends where() constraints to the page query -
  // e.g. a screen paging only one type's rows out of a shared collection
  // (Sent Emails over campaigns type=='email'). Any filter field other than
  // orderByField needs a composite index on (filterField, orderByField) -
  // add it to firestore.indexes.json, don't discover it in prod.
  public async getPage(
    table: string,
    pageSize: number,
    cursor: QueryDocumentSnapshot<DocumentData> | null,
    orderByField: string,
    orderDirection: OrderByDirection = 'asc',
    filters?: QueryParam[],
    fromFirestore?
  ): Promise<PagedResult<T>> {
    const constraints: QueryConstraint[] = (filters ?? []).map((f) => where(f.field, f.operation, f.value));
    constraints.push(orderBy(orderByField, orderDirection));
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(pageSize));

    const snap = await getDocs(query(collection(this.fs, '/' + table), ...constraints));
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
    await setDoc(doc(this.fs, '/' + table + '/' + id), value);

    const retval = await this.getById(id, table, fromFirestore);
    retval.id = id;
    return retval;
  }

  // PARTIAL update via updateDoc - the counterpart to update()'s whole-doc
  // setDoc. Contract:
  // - Only the fields named in `partial` change; everything else on the doc
  //   survives untouched. That's what makes it safe around server-critical
  //   fields the client must never round-trip (e.g. event-registrations'
  //   lastNameLower, the paged Attendees table's sort key).
  // - Values may be FieldValue sentinels (arrayUnion/arrayRemove/increment);
  //   keys may be dot-paths into nested MAPS - but NOT into array elements
  //   (Firestore has no array-index addressing; for embedded-array cases see
  //   EventService.mutateAgendaItem()).
  // - REJECTS if the doc doesn't exist (updateDoc semantics - unlike setDoc,
  //   which would create it); callers must hold a real id.
  // - Returns void ON PURPOSE: no fromFirestore re-read, and never pass a
  //   whole model object here - that writes a stray `id` field and
  //   Date-converted copies of every field, the exact legacy failure mode
  //   the old registerForTrainingSession() had.
  // - Firestore rejects `undefined` values - build keys conditionally, same
  //   house rule as everywhere else (see CLAUDE.md's write gotcha).
  public updateFields(id: string, table: string, partial: Record<string, unknown>): Promise<void> {
    return updateDoc(doc(this.fs, '/' + table + '/' + id), partial);
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
      // A failure here would otherwise error the observable silently -- no
      // error callback is registered at most call sites, so the UI would be
      // left showing stale/empty data with no visible sign anything went
      // wrong. Log it, signal via onError, and fall back to an empty list.
      catchError(err => {
        console.error(`FirebaseDAO.streamAll('${table}') failed:`, err);
        onError?.(err);
        return of([]);
      })
    );
  }

  // Live like streamAll(), but ordered server-side and meant to be paired
  // with a limitCount so "the N most recent docs" is what the listener
  // actually subscribes to, instead of the whole collection. A bare
  // orderBy + limit (no where clause) needs no composite index - Firestore's
  // automatic single-field indexes cover it. Docs missing orderByField
  // entirely are excluded by Firestore's orderBy semantics - fine for a
  // required field like a created/submitted timestamp, not for optional ones.
  public streamAllOrdered(table: string, orderByField: string, orderDirection: OrderByDirection = 'desc', fromFirestore?, limitCount?: number, onError?: (err: unknown) => void): Observable<T[]>{
    const constraints: QueryConstraint[] = [orderBy(orderByField, orderDirection)];
    if (limitCount) constraints.push(limit(limitCount));

    return collectionData(query(collection(this.fs, '/' + table), ...constraints), {idField: 'id'}).pipe(
      map(docs => {
        return this.getDocListFromStream(docs, fromFirestore);
      }),
      catchError(err => {
        console.error(`FirebaseDAO.streamAllOrdered('${table}', '${orderByField}') failed:`, err);
        onError?.(err);
        return of([]);
      })
    );
  }

  public streamByValue(table: string, field: string, value: unknown, fromFirestore?, limitCount?: number, onError?: (err: unknown) => void): Observable<T[]>{
    const constraints: QueryConstraint[] = [where(field, "==", value)];
    if (limitCount) constraints.push(limit(limitCount));

    return collectionData(query(collection(this.fs, '/' + table), ...constraints), {idField: 'id'}).pipe(
      map(docs => {
        return this.getDocListFromStream(docs, fromFirestore);
      }),
      catchError(err => {
        console.error(`FirebaseDAO.streamByValue('${table}', '${field}') failed:`, err);
        onError?.(err);
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

  public queryStreamByValue(table: string, field: string, opStr: WhereFilterOperandKeys, value: unknown, fromFirestore?, limitCount?: number, onError?: (err: unknown) => void): Observable<T[]>{
    const constraints: QueryConstraint[] = [where(field, opStr, value)];
    if (limitCount) constraints.push(limit(limitCount));

    return collectionData(query(collection(this.fs, '/' + table), ...constraints), {idField: 'id'}).pipe(
      map(docs => {
        return this.getDocListFromStream(docs, fromFirestore);
      }),
      catchError(err => {
        console.error(`FirebaseDAO.queryStreamByValue('${table}', '${field}') failed:`, err);
        onError?.(err);
        return of([]);
      })
    );
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
  constructor(field: string, operation: WhereFilterOperandKeys, value: unknown) {
    this.field = field;
    this.operation = operation;
    this.value = value;
  }
  field: string;
  value: unknown;
  operation: WhereFilterOperandKeys;
}
