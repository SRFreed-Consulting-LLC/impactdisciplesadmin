import { Component } from '@angular/core';
import { Tab } from 'impactdisciplescommon/src/models/utils/tab.model';

@Component({
    selector: 'app-requests-manager',
    templateUrl: './requests-manager.component.html',
    styleUrls: ['./requests-manager.component.css'],
    standalone: false
})
export class RequestsManagerComponent {
  selectedIndex: number = 0;
  selectedTab: string = 'Consultation Requests';

  tabs: Tab[] = [
    { id: 0, text: 'Consultation Requests', template: 'Consultation Requests' },
    { id: 1, text: 'Consultation Surveys', template: 'Consultation Surveys' },
    { id: 2, text: 'Lunch and Learn Requests', template: 'Lunch and Learn Requests' },
    { id: 3, text: 'Seminar Requests', template: 'Seminar Requests' }
  ];

  selectTab(e) {
    this.selectedTab = e.itemData.template;
  }
}
