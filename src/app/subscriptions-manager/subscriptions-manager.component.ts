import { Component } from '@angular/core';
import { Tab } from 'impactdisciplescommon/src/models/utils/tab.model';

@Component({
    selector: 'app-subscriptions-manager',
    templateUrl: './subscriptions-manager.component.html',
    styleUrls: ['./subscriptions-manager.component.css'],
    standalone: false
})
export class SubscriptionsManagerComponent {
  selectedIndex: number = 0;
  selectedTab: string = 'Newsletters';

  tabs: Tab[] = [
    { id: 0, text: 'Newsletters', template: 'Newsletters' },
    { id: 1, text: 'Prayer Team', template: 'Prayer Team' }
  ];

  selectTab(e) {
    this.selectedTab = e.itemData.template;
  }
}
