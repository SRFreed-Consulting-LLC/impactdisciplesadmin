import { Component } from '@angular/core';
import { SectionTab } from '../shared/section-tabs/section-tabs.component';

@Component({
    selector: 'app-subscriptions-manager',
    templateUrl: './subscriptions-manager.component.html',
    styleUrls: ['./subscriptions-manager.component.css'],
    standalone: false
})
export class SubscriptionsManagerComponent {
  selectedTab = 'Newsletters';

  tabs: SectionTab[] = [
    { text: 'Newsletters', template: 'Newsletters' },
    { text: 'Prayer Team', template: 'Prayer Team' }
  ];

  selectTab(template: string) {
    this.selectedTab = template;
  }
}
