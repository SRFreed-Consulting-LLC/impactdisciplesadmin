import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { arrayRemove, arrayUnion } from '@angular/fire/firestore';
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
    const params: QueryParam[] = [];
    params.push(new QueryParam('email', WhereFilterOperandKeys.equal, email.toLowerCase()));
    params.push(new QueryParam('eventId', WhereFilterOperandKeys.equal, eventId));

    return await this.queryAllByMultiValue(params);
  }

  // ---- Admin-side breakout assignment (Summit Command Center) ----
  // Awaited, PARTIAL, idempotent: arrayUnion/arrayRemove touch ONLY
  // `trainingSessions` (lastNameLower - the paged Attendees sort key -
  // registrationDate, receipt etc. survive byte-for-byte), a double-click
  // is a no-op, and concurrent writers can't clobber each other. The
  // onEventRegistrationSessionCounts Cloud Function trigger fires on ANY
  // registration write, so the public site's eventSessionCounts stays
  // consistent with zero extra work here. arrayUnion also creates the
  // field when a registration has no trainingSessions array at all.
  //
  // (The old registerForTrainingSession/unregisterForTrainingSession -
  // email+eventId lookups with an UNAWAITED whole-doc update - were
  // deleted 2026-08-19; don't re-import that pattern from the web repo,
  // whose own copies go through Cloud Functions now anyway.)
  assignTrainingSession(registrationId: string, agendaItemId: string): Promise<void> {
    return this.updateFields(registrationId, { trainingSessions: arrayUnion(agendaItemId) });
  }

  removeTrainingSession(registrationId: string, agendaItemId: string): Promise<void> {
    return this.updateFields(registrationId, { trainingSessions: arrayRemove(agendaItemId) });
  }

  streamTrainingSessionList(eventId: string): Observable<EventRegistrationModel[]> {
    return this.streamAllByValue('eventId', eventId)
  }
}
