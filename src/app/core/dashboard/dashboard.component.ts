import { Component, OnInit } from '@angular/core';
import { WhereFilterOperandKeys } from 'impactdisciplescommon/src/dao/firebase.dao';
import { EventRegistrationService } from 'impactdisciplescommon/src/services/data/event-registration.service';
import { EventService } from 'impactdisciplescommon/src/services/data/event.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit{
  eventsList: EventData[] = [];

  constructor(private eventService: EventService, private eventRegistrationService: EventRegistrationService){}

  async ngOnInit(): Promise<void> {

    await this.eventService.queryAllByValue('isActive', WhereFilterOperandKeys.equal, true).then(events => {
      events.forEach(event => {
        let eventData: EventData = new EventData();
        eventData.arg = event.eventName;
        this.eventRegistrationService.queryStreamByValue('eventId',  WhereFilterOperandKeys.equal, event.id).subscribe(registrations => {
            eventData.val = registrations.length;
            this.eventsList.push(eventData);
        })
      })
    })
  }
}

export class EventData {
  arg: string;
  val: number;
}
