import { Component, OnInit } from '@angular/core';
import { Role } from 'impactdisciplescommon/src/lists/roles.enum';
import { Tab } from 'impactdisciplescommon/src/models/utils/tab.model';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';

@Component({
    selector: 'app-events-manager',
    templateUrl: './events-manager.component.html',
    styleUrls: ['./events-manager.component.css'],
    standalone: false
})
export class EventsManagerComponent implements OnInit {
  selectedIndex: number = 0;
  selectedTab: string = 'Events';


  tabs: Tab[] = [
    { id: 0, text: 'Events', template: 'Events', users:[Role.ADMIN]  },
    { id: 1, text: 'Courses', template: 'Courses', users:[Role.ADMIN]  },
    { id: 2, text: 'Coaches', template: 'Coaches', users:[Role.ADMIN]  },
    { id: 3, text: 'Locations', template: 'Locations', users:[Role.ADMIN]  },
    { id: 3, text: 'Organizations', template: 'Organizations', users:[Role.ADMIN]  }
  ];

  secureTabs: Tab[] = [];

  constructor(private authService: AdminAuthService){}

  ngOnInit(): void {
    let userRole = this.authService.getLoggedInUser().role;

    this.secureTabs = this.tabs.filter(item => item.users.find(role => role == userRole));

    this.selectedTab = this.secureTabs[0].template;
  }

  selectTab(e) {
    this.selectedTab = e.itemData.template;
  }
}
