import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { Role } from 'impactdisciplescommon/src/lists/roles.enum';
import { Tab } from 'impactdisciplescommon/src/models/utils/tab.model';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';

@Component({
    selector: 'app-store-manager',
    templateUrl: './store-manager.component.html',
    styleUrls: ['./store-manager.component.css'],
    standalone: false
})
export class StoreManagerComponent implements OnInit, OnDestroy {

  selectedIndex: number = 0;
  selectedTab: string = 'Products';

  tabs: Tab[] = [
    { id: 0, text: 'Products', template: 'Products', users:[Role.ADMIN] },
    { id: 1, text: 'Purchases', template: 'Purchases', users:[Role.ADMIN, Role.EMPLOYEE] },
    { id: 3, text: 'Coupons', template: 'Coupons', users:[Role.ADMIN] },
    { id: 4, text: 'Sales', template: 'Sales', users:[Role.ADMIN] },
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
    this.selectedIndex = e.itemData.id;
  }
}
