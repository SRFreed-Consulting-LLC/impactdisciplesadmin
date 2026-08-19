import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, combineLatest, takeUntil } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { NAV_CONFIG, NavGroup, NavLeaf } from 'src/app/core/main-screen/nav-config';

// Library Manager - same tab-shell shape as every other manager component
// (see contacts-manager.component.ts's own comment for the full
// combineLatest/queryParamMap explanation). Reached by Admin/Root (full
// access, as everywhere) and Role.EDITOR (hard-scoped to only this group -
// see PermissionService.canView()'s own comment) - never by Employee.
@Component({
  selector: 'app-library-manager',
  templateUrl: './library-manager.component.html',
  styleUrls: ['./library-manager.component.css'],
  standalone: false
})
export class LibraryManagerComponent implements OnInit, OnDestroy {
  // Empty until the first loggedInUser$ emission - see
  // campaigns-manager.component.ts's comment on the cold-load permission
  // race a pre-seeded default tab causes.
  selectedTab = '';

  // Sourced from nav-config.ts (the left nav's own data) rather than a
  // second, locally-duplicated list.
  private group: NavGroup = NAV_CONFIG.find((g) => g.id === 'library-manager')!;
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
