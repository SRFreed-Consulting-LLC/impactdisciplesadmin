import { Injectable } from '@angular/core';
import { FirebaseDAO } from '../../dao/firebase.dao';
import { dateFromTimestamp } from '../../utils/date-from-timestamp';
import { Timestamp } from 'firebase/firestore';
import { ConsultationSurveyModel } from '../../models/domain/consultation-survey.model';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class ConsultationSurveyService extends BaseService<ConsultationSurveyModel>{
  constructor(public override dao: FirebaseDAO<ConsultationSurveyModel> ) {
    super(dao)
    this.table="consultation_surveys"
    this.fromFirestore = ConsultationSurveyService.fromFirestore
  }

  static readonly fromFirestore = (data): ConsultationSurveyModel => {
    data.date = dateFromTimestamp(data.date as Timestamp)

    return data;
  };
}
