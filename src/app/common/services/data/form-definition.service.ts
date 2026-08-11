import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { FormDefinitionModel } from 'src/app/common/models/domain/form-definition.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class FormDefinitionService extends BaseService<FormDefinitionModel> {
  constructor(public override dao: FirebaseDAO<FormDefinitionModel>) {
    super(dao);
    this.table = 'forms';
    this.fromFirestore = FormDefinitionService.fromFirestore;
  }

  static readonly fromFirestore = (data): FormDefinitionModel => {
    data.createdAt = dateFromTimestamp(data.createdAt as Timestamp);
    data.updatedAt = dateFromTimestamp(data.updatedAt as Timestamp);
    return data;
  };
}
