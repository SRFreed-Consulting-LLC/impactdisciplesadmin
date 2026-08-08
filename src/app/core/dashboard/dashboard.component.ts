import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { WhereFilterOperandKeys } from 'impactdisciplescommon/src/dao/firebase.dao';
import { EventRegistrationService } from 'impactdisciplescommon/src/services/data/event-registration.service';
import { EventService } from 'impactdisciplescommon/src/services/data/event.service';

@Component({
    selector: 'app-dashboard',
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.css'],
    standalone: false
})
export class DashboardComponent implements OnInit, OnDestroy {
  eventsList: EventData[] = [];

  private ngUnsubscribe = new Subject<void>();

  constructor(private eventService: EventService, private eventRegistrationService: EventRegistrationService){}

  async ngOnInit(): Promise<void> {

    await this.eventService.queryAllByValue('isActive', WhereFilterOperandKeys.equal, true).then(events => {
      events.forEach(event => {
        let eventData: EventData = new EventData();
        eventData.arg = event.eventName;
        this.eventRegistrationService.queryStreamByValue('eventId',  WhereFilterOperandKeys.equal, event.id).pipe(takeUntil(this.ngUnsubscribe)).subscribe(registrations => {
            eventData.val = registrations.length;
            this.eventsList.push(eventData);
        })
      })
    })
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}

export class EventData {
  arg: string;
  val: number;
}
