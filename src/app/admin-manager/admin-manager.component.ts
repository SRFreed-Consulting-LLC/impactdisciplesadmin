import { Component } from '@angular/core';
import { Tab } from 'src/app/common/models/utils/tab.model';

@Component({
    selector: 'app-admin-manager',
    templateUrl: './admin-manager.component.html',
    styleUrls: ['./admin-manager.component.css'],
    standalone: false
})
export class AdminManagerComponent {
  selectedTab = 'Logs';

  tabs: Tab[] = [
    { id: 0, text: 'Logs', template: 'Logs' },
    { id: 1, text: 'Notifications', template: 'Notifications' },
    { id: 2, text: 'Admin Users', template: 'Admin Users' },
    { id: 3, text: 'Customers', template: 'Customers' },
    { id: 4, text: 'Web Config', template: 'Web Config' },
    { id: 5, text: 'Email Templates', template: 'Email Templates' },
    { id: 5, text: 'Shipping Labels', template: 'Shipping Labels' }
  ];

  selectTab(template: string) {
    this.selectedTab = template;
  }
}
