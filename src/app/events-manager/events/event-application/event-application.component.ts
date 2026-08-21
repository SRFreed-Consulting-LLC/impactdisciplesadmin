import { Component, Input } from '@angular/core';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { RICH_TEXT_TOOLBAR } from '../../../shared/rich-text-editor/quill-toolbar.config';

interface ApplicationTab {
  key: string;
  label: string;
}

// The Announcements tab was removed 2026-08-19 (user decision) - the
// attendee-facing announcements idea may return if a Summit PWA gets built;
// the AnnouncementsComponent/AnnouncementDialogComponent code and the
// event-announcements collection live on in git history.
@Component({
    selector: 'app-event-application',
    templateUrl: './event-application.component.html',
    styleUrls: ['./event-application.component.scss'],
    standalone: false
})
export class EventApplicationComponent {
  @Input() event: EventModel;

  selectedTab = 'diningOptions';
  richTextModules = RICH_TEXT_TOOLBAR;

  tabs: ApplicationTab[] = [
    { key: 'diningOptions', label: 'Dining Options' },
    { key: 'checkinInstructions', label: 'Checkin Instructions' },
    { key: 'faq', label: 'Questions and Answers' },
    { key: 'whatsNext', label: 'Whats Next' }
  ];

  selectTab(key: string): void {
    this.selectedTab = key;
  }
}
