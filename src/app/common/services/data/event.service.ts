import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO, QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { AgendaItem } from 'src/app/common/models/domain/utils/agenda-item.model';
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

  // ---- Embedded agenda-item mutation (Summit Command Center's queue) ----
  // The ONE admin write path for a single agenda item's fields (today:
  // waitList). Firestore can't partially update an element of an embedded
  // array (no array-index addressing, and arrayUnion needs a byte-identical
  // map), so this does the safest possible whole-doc write: re-fetch the
  // doc IMMEDIATELY before writing (never trust a stale in-memory
  // EventModel - other staff tabs may have written the same doc), apply
  // one targeted mutation, write straight back with no user interaction in
  // between. (The public site does NOT write waitList - its old self-service
  // prompt never persisted and was removed 2026-08-20; staff are the only
  // writers.) The residual read->write race window is milliseconds wide,
  // loses at most one queue entry, and is no NEW risk class - every
  // Info-tab Save already performs an unguarded whole-doc setDoc over this
  // same doc. Returns the
  // post-mutation model so callers can refresh UI state without re-reading.
  async mutateAgendaItem(eventId: string, agendaItemId: string, mutate: (item: AgendaItem) => void): Promise<EventModel> {
    const fresh = await this.getById(eventId);
    const item = fresh?.agendaItems?.find((i) => i.id === agendaItemId);
    if (!item) {
      throw new Error(`Agenda item ${agendaItemId} not found on event ${eventId}`);
    }
    mutate(item);
    return this.update(eventId, fresh);
  }

  // Ordered waiting queue on a FULL breakout item (see AgendaItem.waitList).
  // Append-at-tail = queue fairness; idempotent; emails normalized the same
  // way registrations store them.
  addToWaitList(eventId: string, agendaItemId: string, email: string): Promise<EventModel> {
    const normalized = email.trim().toLowerCase();
    return this.mutateAgendaItem(eventId, agendaItemId, (item) => {
      item.waitList = item.waitList ?? [];
      if (!item.waitList.includes(normalized)) {
        item.waitList.push(normalized);
      }
    });
  }

  removeFromWaitList(eventId: string, agendaItemId: string, email: string): Promise<EventModel> {
    const normalized = email.trim().toLowerCase();
    return this.mutateAgendaItem(eventId, agendaItemId, (item) => {
      item.waitList = (item.waitList ?? []).filter((x) => x !== normalized);
    });
  }
}
