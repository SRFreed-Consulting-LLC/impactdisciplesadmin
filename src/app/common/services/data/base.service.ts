import { Injectable } from '@angular/core';
import { Unsubscribe } from 'firebase/firestore';
import { FirebaseDAO, WhereFilterOperandKeys, QueryParam } from 'src/app/common/dao/firebase.dao';
import { BaseModel } from 'src/app/common/models/base.model';
import { from, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class BaseService<T extends BaseModel> {
  public table: string = '';
  public fromFirestore;

  constructor(public dao: FirebaseDAO<T>) {}

  // limitCount is optional everywhere below and defaults to unbounded
  // (existing behavior) -- pass it from a page/component to cap how many
  // documents a list/stream query pulls back instead of the whole collection.
  getAll(limitCount?: number): Promise<T[]>{
    return this.dao.getAll(this.table, this.fromFirestore, limitCount);
  }

  getAllByValue(field: string, value: any, limitCount?: number): Promise<T[]>{
    return this.dao.getAllByValue(this.table, field, value, this.fromFirestore, limitCount);
  }

  queryAllByValue(field: string, opStr: WhereFilterOperandKeys, value: any, limitCount?: number): Promise<T[]>{
    return this.dao.queryByValue(this.table, field, opStr, value, this.fromFirestore, limitCount);
  }

  queryAllByMultiValue(queries: QueryParam[], limitCount?: number): Promise<T[]>{
    return this.dao.queryAllByMultiValue(this.table, queries, this.fromFirestore, limitCount)
  }

  getById(id: string): Promise<T>{
    return this.dao.getById(id, this.table, this.fromFirestore);
  }

  streamAll(limitCount?: number): Observable<T[]>{
    return this.dao.streamAll(this.table, this.fromFirestore, limitCount)
  }

  streamAllByValue(field: string, value: any, limitCount?: number): Observable<T[]>{
    return this.dao.streamByValue(this.table, field, value, this.fromFirestore, limitCount)
  }

  streamById(id: string): Observable<T[]>{
    return this.dao.streamByValue(this.table, 'id', id, this.fromFirestore);
  }

  streamRecord(id: string, callBack): Unsubscribe{
    return this.dao.streamById(id, this.table, callBack, this.fromFirestore);
  }

  queryStreamByValue(field: any, opStr: WhereFilterOperandKeys, value: string, limitCount?: number): Observable<T[]>{
    return this.dao.queryStreamByValue(this.table, field, opStr, value, this.fromFirestore, limitCount);
  }

  queryAllStreamByMultiValue(queries: QueryParam[], limitCount?: number): Observable<T[]>{
    return this.dao.queryAllStreamByMultiValue(this.table, queries, this.fromFirestore, limitCount);
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

  createInSubcollection(value: T, record_id: string, subcollection: string): Promise<T>{
    return this.dao.createInSubcollection(value, this.table, record_id, subcollection, this.fromFirestore);
  }

  getAllFromSubCollection(record_id: string, subcollection: string): Promise<T[]> {
    return this.dao.getAllFromSubCollection(this.table, record_id, subcollection, this.fromFirestore);
  }
}
