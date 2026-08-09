import { Component, Input } from '@angular/core';
import { EventModel } from 'src/app/common/models/domain/event.model';
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
export class EventApplicationComponent {
  @Input('event') event: EventModel;

  selectedTab = 'announcements';
  richTextModules = RICH_TEXT_TOOLBAR;

  tabs: ApplicationTab[] = [
    { key: 'announcements', label: 'Announcements' },
    { key: 'diningOptions', label: 'Dining Options' },
    { key: 'checkinInstructions', label: 'Checkin Instructions' },
    { key: 'faq', label: 'Questions and Answers' },
    { key: 'whatsNext', label: 'Whats Next' }
  ];

  selectTab(key: string): void {
    this.selectedTab = key;
  }
}
