import { AgendaItem } from './../../models/domain/utils/agenda-item.model';
import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO, QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { EventRegistrationModel } from 'src/app/common/models/domain/event-registration.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class EventRegistrationService extends BaseService<EventRegistrationModel>{
  constructor(public override dao: FirebaseDAO<EventRegistrationModel> ) {
    super(dao)
    this.table="event-registrations"
    this.fromFirestore = EventRegistrationService.fromFirestore
  }

  static readonly fromFirestore = (data): EventRegistrationModel => {
    data.registrationDate = dateFromTimestamp(data.registrationDate as Timestamp)

    return data;
  };

  async getEventRegistrationById(id: string): Promise<EventRegistrationModel> {
    return await this.getById(id);
  }

  async getEventRegistration(email: string, eventId: string): Promise<EventRegistrationModel[]> {
    let params: QueryParam[] = [];
    params.push(new QueryParam('email', WhereFilterOperandKeys.equal, email.toLowerCase()));
    params.push(new QueryParam('eventId', WhereFilterOperandKeys.equal, eventId));

    return await this.queryAllByMultiValue(params);
  }

  async registerForTrainingSession(email: string, agendaItemId: string, eventId: string): Promise<EventRegistrationModel> {
    let params: QueryParam[] = [];
    params.push(new QueryParam('email', WhereFilterOperandKeys.equal, email.toLowerCase()));
    params.push(new QueryParam('eventId', WhereFilterOperandKeys.equal, eventId));

    let retval = await this.queryAllByMultiValue(params)

    if(retval && retval.length == 1){
      if(!retval[0].trainingSessions){
        retval[0].trainingSessions = [];
      }

      retval[0].trainingSessions.push(agendaItemId);

      this.update(retval[0].id, retval[0]);

      return retval[0];
    }

    return null;
  }

  async unregisterForTrainingSession(email: string, agendaItemId: string, eventId: string): Promise<EventRegistrationModel> {
    let params: QueryParam[] = [];
    params.push(new QueryParam('email', WhereFilterOperandKeys.equal, email.toLowerCase()));
    params.push(new QueryParam('eventId', WhereFilterOperandKeys.equal, eventId));

    let retval = await this.queryAllByMultiValue(params);

    if(retval && retval.length == 1){
      retval[0].trainingSessions = retval[0].trainingSessions.filter(session => session != agendaItemId);

      this.update(retval[0].id, retval[0]);

      return retval[0];
    }

    return null;
  }

  async getUserTrainingSession(email: string, eventId: string): Promise<string []> {
    let params: QueryParam[] = [];
    params.push(new QueryParam('email', WhereFilterOperandKeys.equal, email.toLowerCase()));
    params.push(new QueryParam('eventId', WhereFilterOperandKeys.equal, eventId));

    let retval = await this.queryAllByMultiValue(params);

    if(retval && retval.length == 1){
      return retval[0].trainingSessions;
    }

    return [];
  }

  streamTrainingSessionList(eventId: string): Observable<EventRegistrationModel[]> {
    return this.streamAllByValue('eventId', eventId)
  }
}
