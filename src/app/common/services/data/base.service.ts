import { Injectable } from '@angular/core';
import { DocumentData, OrderByDirection, QueryDocumentSnapshot, Unsubscribe } from 'firebase/firestore';
import { FirebaseDAO, PagedResult, WhereFilterOperandKeys, QueryParam } from 'src/app/common/dao/firebase.dao';
import { BaseModel } from 'src/app/common/models/base.model';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class BaseService<T extends BaseModel> {
  public table = '';
  public fromFirestore;

  constructor(public dao: FirebaseDAO<T>) {}

  // limitCount is optional everywhere below and defaults to unbounded
  // (existing behavior) -- pass it from a page/component to cap how many
  // documents a list/stream query pulls back instead of the whole collection.
  getAll(limitCount?: number): Promise<T[]>{
    return this.dao.getAll(this.table, this.fromFirestore, limitCount);
  }

  getAllByValue(field: string, value: unknown, limitCount?: number): Promise<T[]>{
    return this.dao.getAllByValue(this.table, field, value, this.fromFirestore, limitCount);
  }

  queryAllByMultiValue(queries: QueryParam[], limitCount?: number): Promise<T[]>{
    return this.dao.queryAllByMultiValue(this.table, queries, this.fromFirestore, limitCount)
  }

  getById(id: string): Promise<T>{
    return this.dao.getById(id, this.table, this.fromFirestore);
  }

  // See FirebaseDAO.getPage()'s comment - one-time paged fetch, not a live
  // subscription, for list screens backed by PagedCollectionSource instead
  // of streamAll().
  getPage(pageSize: number, cursor: QueryDocumentSnapshot<DocumentData> | null, orderByField: string, orderDirection: OrderByDirection = 'asc'): Promise<PagedResult<T>>{
    return this.dao.getPage(this.table, pageSize, cursor, orderByField, orderDirection, this.fromFirestore);
  }

  // onError - see FirebaseDAO.streamAll()'s own comment.
  streamAll(limitCount?: number, onError?: (err: unknown) => void): Observable<T[]>{
    return this.dao.streamAll(this.table, this.fromFirestore, limitCount, onError)
  }

  // Live like streamAll(), but ordered + capped server-side - see
  // FirebaseDAO.streamAllOrdered()'s comment (no composite index needed,
  // docs missing orderByField are excluded).
  streamAllOrdered(orderByField: string, orderDirection: OrderByDirection = 'desc', limitCount?: number, onError?: (err: unknown) => void): Observable<T[]>{
    return this.dao.streamAllOrdered(this.table, orderByField, orderDirection, this.fromFirestore, limitCount, onError);
  }

  // onError - see FirebaseDAO.streamAll()'s own comment. Added to these
  // three alongside streamAll() so every stream method can distinguish
  // "really empty" from "failed to load", not just this one.
  streamAllByValue(field: string, value: unknown, limitCount?: number, onError?: (err: unknown) => void): Observable<T[]>{
    return this.dao.streamByValue(this.table, field, value, this.fromFirestore, limitCount, onError)
  }

  streamRecord(id: string, callBack): Unsubscribe{
    return this.dao.streamById(id, this.table, callBack, this.fromFirestore);
  }

  queryStreamByValue(field: string, opStr: WhereFilterOperandKeys, value: unknown, limitCount?: number, onError?: (err: unknown) => void): Observable<T[]>{
    return this.dao.queryStreamByValue(this.table, field, opStr, value, this.fromFirestore, limitCount, onError);
  }

  add(value: T): Promise<T>{
    return this.dao.add(value, this.table, this.fromFirestore);
  }

  update(id: string, value: T): Promise<T>{
    return this.dao.update(id, value, this.table, this.fromFirestore);
  }

  delete(id: string){
    return this.dao.delete(id, this.table);
  }
}
