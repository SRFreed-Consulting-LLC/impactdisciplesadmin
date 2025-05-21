import { Component } from '@angular/core';
import { Tab } from 'impactdisciplescommon/src/models/utils/tab.model';

@Component({
  selector: 'app-web-manager',
  templateUrl: './web-manager.component.html',
  styleUrls: ['./web-manager.component.css']
})
export class WebManagerComponent {
  selectedIndex: number = 0;
  selectedTab: string = 'Disciple Making Minute';

  tabs: Tab[] = [
    { id: 0, text: 'Disciple Making Minute', template: 'Disciple Making Minute' },
    { id: 1, text: 'Pod Casts', template: 'Pod Casts' },
    { id: 2, text: 'Testimonials', template: 'Testimonials' },
    { id: 3, text: 'Hopme Page Images', template: 'Home Page Images' },
  ];

  selectTab(e) {
    this.selectedTab = e.itemData.template;
  }
}
