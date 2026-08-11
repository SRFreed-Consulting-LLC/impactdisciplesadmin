import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, combineLatest, takeUntil } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { NAV_CONFIG, NavGroup, NavLeaf } from 'src/app/core/main-screen/nav-config';

// Tools Manager - utility/configuration screens, not customer or content
// records (Web Config, Email Templates, Shipping Labels, Form Builder -
// the thing that BUILDS a form, as opposed to Custom Form Submissions,
// which is the customer-submitted data that comes back from one and lives
// under Customers Manager instead). Same tab-shell shape as every other
// manager component - see events-manager.component.ts's own comment for
// the full explanation of the combineLatest/queryParamMap pattern below.
@Component({
    selector: 'app-tools-manager',
    templateUrl: './tools-manager.component.html',
    styleUrls: ['./tools-manager.component.css'],
    standalone: false
})
export class ToolsManagerComponent implements OnInit, OnDestroy {
  selectedTab = 'Web Config';

  // Sourced from nav-config.ts (the left nav's own data) rather than a
  // second, locally-duplicated list.
  private group: NavGroup = NAV_CONFIG.find((g) => g.id === 'tools-manager')!;
  items: NavLeaf[] = this.group.items!;
  secureItems: NavLeaf[] = [];

  private ngUnsubscribe = new Subject<void>();

  constructor(private authService: AdminAuthService, private permissionService: PermissionService, private route: ActivatedRoute) {}

  ngOnInit(): void {
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
