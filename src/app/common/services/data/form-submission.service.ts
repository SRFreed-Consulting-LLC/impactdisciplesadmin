import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { FormSubmissionModel } from 'src/app/common/models/domain/form-submission.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class FormSubmissionService extends BaseService<FormSubmissionModel> {
  constructor(public override dao: FirebaseDAO<FormSubmissionModel>) {
    super(dao);
    this.table = 'form_submissions';
    this.fromFirestore = FormSubmissionService.fromFirestore;
  }

  static readonly fromFirestore = (data): FormSubmissionModel => {
    data.submittedAt = dateFromTimestamp(data.submittedAt as Timestamp);
    return data;
  };
}
