import { Component, Input, OnInit } from '@angular/core';
import { Observable, of } from 'rxjs';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { AnnouncementModel } from 'src/app/common/models/domain/announcement.model.ts';
import { EventAnnouncementService } from 'src/app/common/services/data/event-announcement.service';
import { RICH_TEXT_TOOLBAR } from '../../../shared/rich-text-editor/quill-toolbar.config';

interface ApplicationTab {
  key: string;
  label: string;
}

@Component({
    selector: 'app-event-application',
    templateUrl: './event-application.component.html',
    styleUrls: ['./event-application.component.scss'],
    standalone: false
})
export class EventApplicationComponent implements OnInit {
  @Input() event: EventModel;

  selectedTab = 'announcements';
  richTextModules = RICH_TEXT_TOOLBAR;

  // Own, independent read of the same event-announcements collection
  // AnnouncementsComponent already streams for its own editing table -
  // that component doesn't expose its stream upward, and this one exists
  // purely to feed the phone preview column (see the .html), not to
  // duplicate/replace the editing UI in the middle column.
  announcements$: Observable<AnnouncementModel[]> = of([]);

  tabs: ApplicationTab[] = [
    { key: 'announcements', label: 'Announcements' },
    { key: 'diningOptions', label: 'Dining Options' },
    { key: 'checkinInstructions', label: 'Checkin Instructions' },
    { key: 'faq', label: 'Questions and Answers' },
    { key: 'whatsNext', label: 'Whats Next' }
  ];

  constructor(private announcementService: EventAnnouncementService) {}

  ngOnInit(): void {
    this.announcements$ = this.event?.id ? this.announcementService.streamAllByValue('eventId', this.event.id) : of([]);
  }

  selectTab(key: string): void {
    this.selectedTab = key;
  }
}
