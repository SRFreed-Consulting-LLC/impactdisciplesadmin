import { Component } from '@angular/core';
import { Tab } from 'impactdisciplescommon/src/models/utils/tab.model';

@Component({
    selector: 'app-page-manager',
    templateUrl: './page-manager.component.html',
    styleUrls: ['./page-manager.component.css'],
    standalone: false
})
export class PageManagerComponent {
  selectedIndex: number = 0;
  selectedTab: string = 'Cards';

  tabs: Tab[] = [
    { id: 0, text: 'Cards', template: 'Cards' },
    { id: 1, text: 'Components', template: 'Components' },
    { id: 2, text: 'Forms', template: 'Forms' },
    { id: 3, text: 'Macros', template: 'Macros' },
    { id: 4, text: 'Menu', template: 'Menu' },
    { id: 5, text: 'Pages', template: 'Pages' },
    { id: 6, text: 'Splash Screens', template: 'Splash Screens' }
  ];

  selectTab(e) {
    this.selectedTab = e.itemData.template;
    this.selectedIndex = e.itemData.id;
  }
}
