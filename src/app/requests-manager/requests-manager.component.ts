import { Component } from '@angular/core';
import { SectionTab } from '../shared/section-tabs/section-tabs.component';

@Component({
    selector: 'app-requests-manager',
    templateUrl: './requests-manager.component.html',
    styleUrls: ['./requests-manager.component.css'],
    standalone: false
})
export class RequestsManagerComponent {
  selectedTab: string = 'Consultation Requests';

  tabs: SectionTab[] = [
    { text: 'Consultation Requests', template: 'Consultation Requests' },
    { text: 'Consultation Surveys', template: 'Consultation Surveys' },
    { text: 'Lunch and Learn Requests', template: 'Lunch and Learn Requests' },
    { text: 'Seminar Requests', template: 'Seminar Requests' }
  ];

  selectTab(template: string) {
    this.selectedTab = template;
  }
}
