import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { Role } from 'impactdisciplescommon/src/lists/roles.enum';
import { Tab } from 'impactdisciplescommon/src/models/utils/tab.model';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';

@Component({
    selector: 'app-events-manager',
    templateUrl: './events-manager.component.html',
    styleUrls: ['./events-manager.component.css'],
    standalone: false
})
export class EventsManagerComponent implements OnInit, OnDestroy {
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

  private ngUnsubscribe = new Subject<void>();

  constructor(private authService: AdminAuthService){}

  ngOnInit(): void {
    // Was: this.authService.getLoggedInUser().role, which reads the
    // "impact-disciples-user" cookie - see MainScreenComponent.ngOnInit for
    // the full explanation of why that can be null (a valid Firebase
    // session with a stale/expired cookie). dao.loggedInUser$ re-derives
    // the AppUser from Firebase's own live auth state instead.
    this.authService.dao.loggedInUser$.pipe(takeUntil(this.ngUnsubscribe)).subscribe((user) => {
      this.secureTabs = this.tabs.filter(item => item.users.find(role => role == user?.role));
      this.selectedTab = this.secureTabs[0]?.template ?? this.selectedTab;
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  selectTab(e) {
    this.selectedTab = e.itemData.template;
  }
}
