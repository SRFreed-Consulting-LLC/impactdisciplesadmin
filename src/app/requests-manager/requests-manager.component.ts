import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, combineLatest, takeUntil } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { NAV_CONFIG, NavGroup, NavLeaf } from 'src/app/core/main-screen/nav-config';

@Component({
    selector: 'app-requests-manager',
    templateUrl: './requests-manager.component.html',
    styleUrls: ['./requests-manager.component.css'],
    standalone: false
})
export class RequestsManagerComponent implements OnInit, OnDestroy {
  selectedTab = 'Consultation Requests';

  // Sourced from nav-config.ts (the left nav's own data) rather than a
  // second, locally-duplicated list - also where the new-record-alerts
  // bell's ?tab= slugs for this module are defined (they must match).
  private group: NavGroup = NAV_CONFIG.find((g) => g.id === 'requests-manager')!;
  items: NavLeaf[] = this.group.items!;
  secureItems: NavLeaf[] = [];

  private ngUnsubscribe = new Subject<void>();

  constructor(private authService: AdminAuthService, private permissionService: PermissionService, private route: ActivatedRoute) {}

  ngOnInit(): void {
    // Combines both live sources (permissions -> which tabs are even
    // visible, and ?tab= -> which one the left nav/bell wants open) - see
    // events-manager.component.ts's own comment for the full explanation.
    combineLatest([this.authService.dao.loggedInUser$, this.route.queryParamMap])
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe(([, params]) => {
        this.secureItems = this.items.filter((item) => this.permissionService.canViewNavItem(this.group, item));
        const requested = this.secureItems.find((item) => item.slug === params.get('tab'));
        this.selectedTab = requested?.label ?? this.secureItems[0]?.label ?? this.selectedTab;
      });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
