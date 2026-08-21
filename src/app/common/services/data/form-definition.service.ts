import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { FormDefinitionModel } from '@impact-common/shared/models/domain/form-definition.model';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';
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
