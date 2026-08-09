import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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

// See requests-manager.component.ts's TAB_SLUGS for the matching half of
// this - the new-record-alerts bell only ever needs to reach Purchases here.
const TAB_SLUGS: Record<string, string> = {
  purchases: 'Purchases'
};

@Component({
    selector: 'app-store-manager',
    templateUrl: './store-manager.component.html',
    styleUrls: ['./store-manager.component.css'],
    standalone: false
})
export class StoreManagerComponent implements OnInit, OnDestroy {

  selectedTab = 'Products';

  tabs: RoleGatedTab[] = [
    { text: 'Products', template: 'Products', users: [Role.ADMIN] },
    { text: 'Purchases', template: 'Purchases', users: [Role.ADMIN, Role.EMPLOYEE] },
    { text: 'Coupons', template: 'Coupons', users: [Role.ADMIN] },
    { text: 'Sales', template: 'Sales', users: [Role.ADMIN] },
  ];

  secureTabs: SectionTab[] = [];

  private ngUnsubscribe = new Subject<void>();

  constructor(private authService: AdminAuthService, private route: ActivatedRoute){}

  ngOnInit(): void {
    const slug = this.route.snapshot.queryParamMap.get('tab');
    const requestedTab = slug ? TAB_SLUGS[slug] : undefined;

    // Was: this.authService.getLoggedInUser().role, which reads the
    // "impact-disciples-user" cookie - see MainScreenComponent.ngOnInit for
    // the full explanation of why that can be null (a valid Firebase
    // session with a stale/expired cookie). dao.loggedInUser$ re-derives
    // the AdminUser from Firebase's own live auth state instead.
    this.authService.dao.loggedInUser$.pipe(takeUntil(this.ngUnsubscribe)).subscribe((user) => {
      this.secureTabs = this.tabs.filter(item => item.users.find(role => role == user?.role));

      // Only honor the query param if that tab is actually visible to this
      // user's role - otherwise fall back to today's default-first-tab
      // behavior.
      const requestedTabIsVisible = requestedTab && this.secureTabs.some(t => t.template === requestedTab);
      this.selectedTab = requestedTabIsVisible ? requestedTab : (this.secureTabs[0]?.template ?? this.selectedTab);
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
