import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, combineLatest, takeUntil } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { NAV_CONFIG, NavGroup, NavLeaf } from 'src/app/core/main-screen/nav-config';

// Contacts Manager (nee Customers Manager, renamed 2026-08-19) - everything
// that's either a contact record or something a contact/site visitor
// submitted (Contacts, Purchases + Fulfillment, Custom Form Submissions) - see
// nav-config.ts's own comment on this group. Same tab-shell shape as every
// other manager component (events-manager.component.ts's own comment has
// the full explanation of the combineLatest/queryParamMap pattern below) -
// also where the new-record-alerts bell's Purchases/Custom Form
// Submissions ?tab= slugs are defined (must match).
@Component({
    selector: 'app-contacts-manager',
    templateUrl: './contacts-manager.component.html',
    styleUrls: ['./contacts-manager.component.css'],
    standalone: false
})
export class ContactsManagerComponent implements OnInit, OnDestroy {
  // Empty until the first loggedInUser$ emission - see
  // campaigns-manager.component.ts's comment on the cold-load permission
  // race a pre-seeded default tab causes.
  selectedTab = '';

  // Sourced from nav-config.ts (the left nav's own data) rather than a
  // second, locally-duplicated list.
  private group: NavGroup = NAV_CONFIG.find((g) => g.id === 'contacts-manager')!;
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
