import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { Role } from 'src/app/common/lists/roles.enum';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { SectionTab } from '../shared/section-tabs/section-tabs.component';

// SectionTab itself has no role field (role-filtering already happens here,
// upstream of the tab bar) - this local extension carries `users` only
// through the filtering step below, same shape the original Tab[] had
// minus the unused `id` (which had a pre-existing bug: Coupons and Sales
// both used id: 3/4 inconsistently with array position - moot now that
// dropping `id` removes the field that could go stale at all).
interface RoleGatedTab extends SectionTab {
  users: Role[];
}

@Component({
    selector: 'app-store-manager',
    templateUrl: './store-manager.component.html',
    styleUrls: ['./store-manager.component.css'],
    standalone: false
})
export class StoreManagerComponent implements OnInit, OnDestroy {

  selectedTab: string = 'Products';

  tabs: RoleGatedTab[] = [
    { text: 'Products', template: 'Products', users: [Role.ADMIN] },
    { text: 'Purchases', template: 'Purchases', users: [Role.ADMIN, Role.EMPLOYEE] },
    { text: 'Coupons', template: 'Coupons', users: [Role.ADMIN] },
    { text: 'Sales', template: 'Sales', users: [Role.ADMIN] },
  ];

  secureTabs: SectionTab[] = [];

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

  selectTab(template: string): void {
    this.selectedTab = template;
  }
}
