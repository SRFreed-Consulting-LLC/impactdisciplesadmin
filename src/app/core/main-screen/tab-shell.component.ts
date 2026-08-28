import { Directive, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, combineLatest, takeUntil } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { NAV_CONFIG, NavGroup, NavLeaf } from './nav-config';

/**
 * The tab shell every `*-manager` screen is.
 *
 * Nine components carried a byte-identical copy of this (2026-08-27 sweep,
 * P2) - diffing any two left only the class name, selector, templateUrl,
 * styleUrls and the NAV_CONFIG group id. The reason to collapse them is not
 * line count: TWO SECURITY-RELEVANT FIXES had been replicated across those
 * nine copies BY HAND, and each shell's comment pointed at a different
 * sibling for the reasoning - contacts cited events, library cited contacts,
 * everyone cited campaigns - so the explanation had no owner and any future
 * gating change was nine edits with a bypass if one was missed.
 *
 * Both fixes now live here, once:
 *
 * 1. `selectedTab` STARTS EMPTY. A hardcoded default tab renders a screen's
 *    content to anyone whose `secureItems` is empty - the direct-URL bypass.
 *    Do not "improve" this by seeding it with the first tab.
 *
 * 2. Permissions and `?tab=` are read as a LIVE `combineLatest`, never once.
 *    The left nav lets an admin click between sibling tabs while already on
 *    this route, which Angular resolves as a same-route, query-param-only
 *    navigation: no new component instance, `ngOnInit` does not re-fire, and
 *    a one-time snapshot read goes stale after the first click. Keeping
 *    `loggedInUser$` in the combine also re-filters the moment a permission
 *    changes - the cold-load race, live-diagnosed 2026-08-18, where
 *    permissions arrive AFTER first render and a single read leaves the tab
 *    list empty forever.
 *
 * A subclass supplies only its `groupId`, and may override `filterItems` for
 * gating a permission grant cannot express (see AdminManagerComponent and
 * the Root-only E2E Dashboard).
 */
@Directive()
export abstract class TabShellComponent implements OnInit, OnDestroy {
  /** The NAV_CONFIG group this shell renders. The ONLY thing most
   *  subclasses need to provide. */
  protected abstract readonly groupId: string;

  // Empty until the first emission - see (1) above.
  selectedTab = '';

  /** Sourced from nav-config.ts (the left nav's own data) rather than a
   *  second, locally-duplicated list. */
  get items(): NavLeaf[] {
    return this.group.items ?? [];
  }

  secureItems: NavLeaf[] = [];

  private _group?: NavGroup;
  protected readonly ngUnsubscribe = new Subject<void>();

  constructor(
    protected authService: AdminAuthService,
    protected permissionService: PermissionService,
    protected route: ActivatedRoute
  ) {}

  /** Resolved lazily: `groupId` is a subclass field, and subclass field
   *  initializers run AFTER this base's constructor body. */
  protected get group(): NavGroup {
    this._group ??= NAV_CONFIG.find((g) => g.id === this.groupId)!;
    return this._group;
  }

  ngOnInit(): void {
    combineLatest([this.authService.dao.loggedInUser$, this.route.queryParamMap])
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe(([user, params]) => {
        this.secureItems = this.filterItems(this.items, user);
        const requested = this.secureItems.find(
          (item) => item.slug === params.get('tab')
        );
        this.selectedTab =
          requested?.label ?? this.secureItems[0]?.label ?? this.selectedTab;
      });
  }

  /**
   * Which of this group's screens the signed-in user may see.
   *
   * Override to add gating the permission system cannot express, and call
   * `super.filterItems(...)` so the grant check still applies.
   * The base ignores `user` - a grant check needs nothing but the item -
   * but it is in the signature because the one override that exists needs
   * it, and a hook that cannot see the user could not express a role gate.
   * @param {NavLeaf[]} items Every screen in this group.
   * @param {unknown} user The signed-in user, for role-based gating.
   * @return {NavLeaf[]} The visible subset.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected filterItems(items: NavLeaf[], user: unknown): NavLeaf[] {
    return items.filter(
      (item) => this.permissionService.canViewNavItem(this.group, item)
    );
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
