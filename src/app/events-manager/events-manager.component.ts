import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { Role } from 'impactdisciplescommon/src/lists/roles.enum';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import { SectionTab } from '../shared/section-tabs/section-tabs.component';

// SectionTab itself has no role field (role-filtering already happens
// here, upstream of the tab bar) - this local extension carries `users`
// only through the filtering step below, same shape the original Tab[]
// had minus the unused `id` (which had a pre-existing bug: Locations and
// Organizations both used id: 3 - moot now that dropping `id` removes the
// field that could go stale at all). Same pattern as the Store Manager
// shell migration (commit 8b0a188).
interface RoleGatedTab extends SectionTab {
  users: Role[];
}

@Component({
    selector: 'app-events-manager',
    templateUrl: './events-manager.component.html',
    styleUrls: ['./events-manager.component.css'],
    standalone: false
})
export class EventsManagerComponent implements OnInit, OnDestroy {
  selectedTab: string = 'Events';

  tabs: RoleGatedTab[] = [
    { text: 'Events', template: 'Events', users: [Role.ADMIN] },
    { text: 'Courses', template: 'Courses', users: [Role.ADMIN] },
    { text: 'Coaches', template: 'Coaches', users: [Role.ADMIN] },
    { text: 'Locations', template: 'Locations', users: [Role.ADMIN] },
    { text: 'Organizations', template: 'Organizations', users: [Role.ADMIN] }
  ];

  secureTabs: SectionTab[] = [];

  private ngUnsubscribe = new Subject<void>();

  constructor(private authService: AdminAuthService) {}

  ngOnInit(): void {
    // Was: this.authService.getLoggedInUser().role, which reads the
    // "impact-disciples-user" cookie - see MainScreenComponent.ngOnInit for
    // the full explanation of why that can be null (a valid Firebase
    // session with a stale/expired cookie). dao.loggedInUser$ re-derives
    // the AppUser from Firebase's own live auth state instead.
    this.authService.dao.loggedInUser$.pipe(takeUntil(this.ngUnsubscribe)).subscribe((user) => {
      this.secureTabs = this.tabs.filter((item) => item.users.find((role) => role == user?.role));
      this.selectedTab = this.secureTabs[0]?.template ?? this.selectedTab;
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  selectTab(template: string): void {
    this.selectedTab = template;
  }
}
