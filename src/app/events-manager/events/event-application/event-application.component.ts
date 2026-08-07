import { Component, Input, OnInit } from '@angular/core';
import { EventModel } from 'impactdisciplescommon/src/models/domain/event.model';
import { Tab } from 'impactdisciplescommon/src/models/utils/tab.model';

@Component({
    selector: 'app-event-application',
    templateUrl: './event-application.component.html',
    styleUrls: ['./event-application.component.css'],
    standalone: false
})
export class EventApplicationComponent implements OnInit {
  @Input('event') event: EventModel;

  selectedTab = 'Announcements';

  selectedIndex: number = 0;

  tabs: Tab[] = [
    { id: 0, text: 'Announcements', template: 'Announcements' },
    { id: 1, text: 'Dining Options', template: 'Dining Options' },
    { id: 2, text: 'Checkin Instructions', template: 'Checkin Instructions' },
    { id: 3, text: 'Questions and Answers', template: 'Questions and Answers' },
    { id: 4, text: 'Whats Next', template: 'Whats Next' },
  ];

  constructor() { }

  ngOnInit() {
  }

  selectTab(e) {
    this.selectedTab = e.itemData.template;
  }

}
