import { Component } from '@angular/core';
import { SectionTab } from '../shared/section-tabs/section-tabs.component';

@Component({
    selector: 'app-web-manager',
    templateUrl: './web-manager.component.html',
    styleUrls: ['./web-manager.component.css'],
    standalone: false
})
export class WebManagerComponent {
  selectedTab = 'Disciple Making Minute';

  tabs: SectionTab[] = [
    { text: 'Disciple Making Minute', template: 'Disciple Making Minute' },
    { text: 'Pod Casts', template: 'Pod Casts' },
    { text: 'Testimonials', template: 'Testimonials' },
    { text: 'Home Page Images', template: 'Home Page Images' },
    { text: 'Home Page Popups', template: 'Home Page Popups' },
    { text: 'Monthly Newsletter', template: 'Monthly Newsletter' },
  ];

  selectTab(template: string) {
    this.selectedTab = template;
  }
}
