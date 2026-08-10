import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, combineLatest, takeUntil } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { hasRole } from 'src/app/common/lists/roles.enum';
import { NAV_CONFIG, NavLeaf } from 'src/app/core/main-screen/nav-config';

@Component({
    selector: 'app-events-manager',
    templateUrl: './events-manager.component.html',
    styleUrls: ['./events-manager.component.css'],
    standalone: false
})
export class EventsManagerComponent implements OnInit, OnDestroy {
  selectedTab = 'Events';

  // Sourced from nav-config.ts (the left nav's own data) rather than a
  // second, locally-duplicated list.
  items: NavLeaf[] = NAV_CONFIG.find((g) => g.id === 'events-manager')!.items!;
  secureItems: NavLeaf[] = [];

  private ngUnsubscribe = new Subject<void>();

  constructor(private authService: AdminAuthService, private route: ActivatedRoute) {}

  ngOnInit(): void {
    // Combines both live sources (role -> which tabs are even visible, and
    // ?tab= -> which one the left nav wants open) rather than reading
    // either one once - the left nav lets an admin click between sibling
    // tabs while already on this route, which Angular resolves as a
    // same-route, query-param-only navigation (no new component instance,
    // so ngOnInit itself doesn't re-fire and a one-time snapshot read would
    // go stale after the first click).
    combineLatest([this.authService.dao.loggedInUser$, this.route.queryParamMap])
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe(([user, params]) => {
        this.secureItems = this.items.filter((item) => !item.roles || hasRole(user?.role, item.roles));
        const requested = this.secureItems.find((item) => item.slug === params.get('tab'));
        this.selectedTab = requested?.label ?? this.secureItems[0]?.label ?? this.selectedTab;
      });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
