import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO, QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class EventService extends BaseService<EventModel>{
  constructor(public override dao: FirebaseDAO<EventModel> ) {
    super(dao)
    this.table="events"
    this.fromFirestore = EventService.fromFirestore
  }

  static readonly fromFirestore = (data): EventModel => {
    data.startDate = dateFromTimestamp(data.startDate as Timestamp);
    data.endDate = dateFromTimestamp(data.endDate as Timestamp);

    if(data.agendaItems){
      data.agendaItems.forEach(item => {
        item.startDate = dateFromTimestamp(item.startDate);
        item.endDate = dateFromTimestamp(item.endDate);
      });
    }

    return data;
  }

  public async isSummitPosted(): Promise<boolean> {
        const qp: QueryParam[] = [];
        qp.push(new QueryParam('isActive', WhereFilterOperandKeys.equal, true));
        qp.push(new QueryParam('isSummit', WhereFilterOperandKeys.equal, true));

        return await  this.queryAllByMultiValue(qp).then(events => {
          return events.length > 0;
        })
  }
}
