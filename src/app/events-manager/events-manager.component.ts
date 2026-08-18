import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, combineLatest, takeUntil } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { NAV_CONFIG, NavGroup, NavLeaf } from 'src/app/core/main-screen/nav-config';

@Component({
    selector: 'app-events-manager',
    templateUrl: './events-manager.component.html',
    styleUrls: ['./events-manager.component.css'],
    standalone: false
})
export class EventsManagerComponent implements OnInit, OnDestroy {
  // Empty until the first loggedInUser$ emission - see
  // campaigns-manager.component.ts's comment on the cold-load permission
  // race a pre-seeded default tab causes.
  selectedTab = '';

  // Sourced from nav-config.ts (the left nav's own data) rather than a
  // second, locally-duplicated list.
  private group: NavGroup = NAV_CONFIG.find((g) => g.id === 'events-manager')!;
  items: NavLeaf[] = this.group.items!;
  secureItems: NavLeaf[] = [];

  private ngUnsubscribe = new Subject<void>();

  constructor(private authService: AdminAuthService, private permissionService: PermissionService, private route: ActivatedRoute) {}

  ngOnInit(): void {
    // Combines both live sources (permissions -> which tabs are even
    // visible, and ?tab= -> which one the left nav wants open) rather than
    // reading either one once - the left nav lets an admin click between
    // sibling tabs while already on this route, which Angular resolves as a
    // same-route, query-param-only navigation (no new component instance,
    // so ngOnInit itself doesn't re-fire and a one-time snapshot read would
    // go stale after the first click). loggedInUser$ itself isn't consumed
    // directly here anymore (see PermissionService, which subscribes to it
    // independently) - only kept in this combineLatest so a permission
    // change re-filters secureItems the moment the user doc updates,
    // exactly like before.
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
