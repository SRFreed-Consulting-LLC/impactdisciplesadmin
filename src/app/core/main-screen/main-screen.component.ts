import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Subject, filter, takeUntil } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';
import { PermissionService } from 'src/app/common/services/permission.service';
// Injected purely to trigger its construction (providedIn: 'root' alone
// doesn't instantiate it) - see that service's own comment on why the
// shell is where this belongs.
import { PermissionMigrationService } from 'src/app/common/services/permission-migration.service';
import { ScreenPermissionsDialogComponent } from './screen-permissions-dialog/screen-permissions-dialog.component';
import { NAV_CONFIG, NavGroup, NavLeaf } from './nav-config';

interface PinnedNavItem {
  group: NavGroup;
  item: NavLeaf;
}

@Component({
    selector: 'app-main-screen',
    templateUrl: './main-screen.component.html',
    styleUrls: ['./main-screen.component.scss'],
    standalone: false
})
export class MainScreenComponent implements OnInit, OnDestroy {
  secureNav: NavGroup[] = [];

  // Backs the user menu (name/email/role + Settings + Log Off) in the
  // toolbar - set from the same loggedInUser$ emission secureNav is built
  // from, no separate subscription needed.
  currentUser: AdminUser | null = null;

  // "Pin to top" shortcuts - screens the user has pinned, in their own
  // chosen order, filtered through the same canViewNavItem() check as
  // secureNav so a pinned screen an Employee later loses access to just
  // quietly stops appearing rather than dangling as a broken link. Rebuilt
  // any time currentUser changes (login, or a pin toggle - see
  // togglePin()/rebuildPinnedItems()).
  pinnedItems: PinnedNavItem[] = [];

  // Which manager groups are currently open - multiple can be open at once
  // (no accordion-exclusive behavior). A group is also auto-added here
  // whenever navigation lands on it (left nav click, the new-record-alerts
  // bell, or a bookmarked URL), so arriving at a manager always shows its
  // own sub-items without an extra click.
  expanded = new Set<string>();

  // Derived from the current URL - drives active-state highlighting for
  // both a group's own row and its sub-items. Computed manually here rather
  // than via routerLinkActive, which doesn't cleanly express "active only
  // when this specific ?tab= matches" alongside "active because this is the
  // open group with no sub-item selected yet".
  activeGroupId: string | null = null;
  activeSlug: string | null = null;

  // Whether the mouse is currently over the drawer - transient, not
  // persisted. Combined with the persisted drawerPinned preference below to
  // decide the drawer's actual expanded/collapsed width; see drawerExpanded.
  private drawerHovered = false;

  // Whether a row's "⋮" menu is currently open - CDK menu overlays render
  // outside the mat-sidenav's own DOM subtree (appended to the global
  // overlay container, not nested inside it), so moving the mouse from the
  // "⋮" button into its now-open menu fires a real mouseleave on the
  // drawer even though the menu visually sits right next to/over it. Both
  // drive drawerExpanded so the drawer doesn't yank shut mid-interaction.
  private rowMenuOpen = false;

  private ngUnsubscribe = new Subject<void>();

  constructor(
    private authService: AdminAuthService,
    private permissionService: PermissionService,
    private permissionMigrationService: PermissionMigrationService,
    private adminUserService: AdminUserService,
    private dialog: MatDialog,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Was: this.authService.getLoggedInUser().role, which reads the
    // "impact-disciples-user" cookie - see this component's git history for
    // the full explanation of why that can be null (a valid Firebase
    // session with a stale/expired cookie). dao.loggedInUser$ re-derives
    // the AdminUser from Firebase's own live auth state instead.
    this.authService.dao.loggedInUser$.pipe(takeUntil(this.ngUnsubscribe)).subscribe((user) => {
      this.currentUser = user;
      // Admin/Root: unchanged, still driven by NAV_CONFIG's own `roles`.
      // Employee: fully permission-driven now (see PermissionService) - a
      // manager only shows once it (or something under it) has been
      // granted; `roles` no longer factors in for them at all, and
      // group.roles itself is left alone here since PermissionService's own
      // isFullAccess() check already short-circuits Admin/Root.
      this.secureNav = NAV_CONFIG
        .filter((group) => this.permissionService.isFullAccess() || this.permissionService.canView(group.id))
        .map((group) => ({
          ...group,
          items: group.items?.filter((item) => !item.hideFromNav && this.permissionService.canViewNavItem(group, item))
        }))
        // A group with `items` defined but every one of them filtered out
        // (Admin Manager today - Logs/Admin Users are both hideFromNav) has
        // nothing to show - drop it rather than render an expandable header
        // that opens to nothing. Home (items undefined) always passes this
        // check, `!group.items` short-circuits before the length check.
        .filter((group) => !group.items || group.items.length > 0);

      this.rebuildPinnedItems();
    });

    this.syncActiveFromUrl(this.router.url);
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntil(this.ngUnsubscribe)
      )
      .subscribe((event) => this.syncActiveFromUrl(event.urlAfterRedirects));
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  // Render-only label diet for the navy redesign: "CUSTOMERS MANAGER" shows
  // as "CUSTOMERS" in the drawer. Display concern only - nav-config labels
  // themselves are untouched because they feed permission screenKeys and the
  // Reports Manager tab shell reads its group by label conventions.
  displayGroupLabel(label: string): string {
    return label.replace(/\s+manager$/i, '');
  }

  toggleGroup(id: string): void {
    if (this.expanded.has(id)) {
      this.expanded.delete(id);
    } else {
      this.expanded.add(id);
    }
  }

  isPinned(group: NavGroup, item: NavLeaf): boolean {
    return (this.currentUser?.pinnedScreens ?? []).includes(this.pinKey(group, item));
  }

  // Only Admin/Root can see or edit who else has access - an Employee
  // browsing their own nav shouldn't be able to view (let alone change)
  // another employee's grants, even ones scoped to a screen they can
  // already see themselves.
  get canManagePermissions(): boolean {
    return this.permissionService.isFullAccess();
  }

  // Gates the user-menu dropdown's "Admin Users" link (see the template) -
  // same Admin/Root-only check as canManagePermissions above (and as
  // nav-config.ts's employeeGrantable: false on the Admin Users NavLeaf,
  // which is what actually blocks an Employee who navigated there directly
  // by URL) but its own getter since the two gate unrelated pieces of UI
  // that just happen to share a rule today.
  get canManageAdminUsers(): boolean {
    return this.permissionService.isFullAccess();
  }

  // Gates the user-menu dropdown's "Logs" link (see the template) - same
  // Admin/Root-only check as canManageAdminUsers above, and its own getter
  // for the same "unrelated UI, same rule today" reason.
  get canManageLogs(): boolean {
    return this.permissionService.isFullAccess();
  }

  // "Who has access to this screen" - the inverse view of Admin Users'
  // own Permissions tab (that's one employee x every screen; this is one
  // screen x every employee). See ScreenPermissionsDialogComponent's own
  // comment - modeled on impact-discipleship-library-manager-new's
  // per-node "Manage Permissions" tree menu.
  openScreenPermissions(group: NavGroup, item: NavLeaf): void {
    if (!this.canManagePermissions) {
      return;
    }
    this.dialog.open(ScreenPermissionsDialogComponent, {
      width: '600px',
      maxWidth: '95vw',
      data: { screenKey: this.pinKey(group, item), screenLabel: item.label }
    });
  }

  // Toggles a screen's pin state - optimistic (updates the nav immediately)
  // with a revert on write failure, since loggedInUser$ is a one-time read
  // per auth-state change (see FireAuthDao), not a live Firestore listener -
  // nothing will re-pull the new pinnedScreens value on its own the way a
  // streamed subscription would.
  togglePin(group: NavGroup, item: NavLeaf): void {
    if (!this.currentUser?.id) {
      return;
    }

    const key = this.pinKey(group, item);
    const current = this.currentUser.pinnedScreens ?? [];
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];

    const previousUser = this.currentUser;
    this.currentUser = { ...this.currentUser, pinnedScreens: next };
    this.rebuildPinnedItems();

    // Full record, not a partial {pinnedScreens} - update() is a full
    // setDoc under the hood (no merge), same reason every other write in
    // this app spreads the previous record first.
    this.adminUserService.update(this.currentUser.id, this.currentUser).catch((err) => {
      console.error('Failed to save pinned screens:', err);
      this.currentUser = previousUser;
      this.rebuildPinnedItems();
    });
  }

  private pinKey(group: NavGroup, item: NavLeaf): string {
    return `${group.id}.${item.slug}`;
  }

  private rebuildPinnedItems(): void {
    const pinned = this.currentUser?.pinnedScreens ?? [];
    if (pinned.length === 0) {
      this.pinnedItems = [];
      return;
    }

    const items: PinnedNavItem[] = [];
    for (const group of NAV_CONFIG) {
      for (const item of group.items ?? []) {
        if (item.hideFromNav) {
          continue; // Admin Users - never a drawer row, so never a pinnable shortcut either.
        }
        if (pinned.includes(this.pinKey(group, item)) && this.permissionService.canViewNavItem(group, item)) {
          items.push({ group, item });
        }
      }
    }

    // Preserve the order the user pinned them in, not NAV_CONFIG's own
    // manager-by-manager order.
    items.sort((a, b) => pinned.indexOf(this.pinKey(a.group, a.item)) - pinned.indexOf(this.pinKey(b.group, b.item)));
    this.pinnedItems = items;
  }

  // ---- Collapsible drawer ----
  //
  // Unpinned (the new default is actually "pinned", see isDrawerPinned) -
  // the drawer sits collapsed to an icon-only rail and expands only while
  // the mouse is over it, auto-collapsing again on mouseleave, the same
  // auto-hide-sidebar pattern VSCode/most IDEs use. Pinned keeps it at full
  // width permanently, identical to this app's behavior before this
  // feature existed - drawerPinned undefined (every account that predates
  // this) defaults to pinned so nobody's nav silently starts collapsing on
  // them.

  get isDrawerPinned(): boolean {
    return this.currentUser?.drawerPinned !== false;
  }

  get drawerExpanded(): boolean {
    return this.isDrawerPinned || this.drawerHovered || this.rowMenuOpen;
  }

  onDrawerMouseEnter(): void {
    this.drawerHovered = true;
  }

  onDrawerMouseLeave(): void {
    // Ignore the leave while a row menu is open - see rowMenuOpen's own
    // comment on why the mouse crossing into the menu overlay looks like a
    // real mouseleave here even though the user hasn't actually left the
    // interaction. onRowMenuClosed() re-syncs drawerHovered once the menu
    // itself closes, so a genuine subsequent mouseleave still collapses
    // the drawer normally after that.
    if (this.rowMenuOpen) {
      return;
    }
    this.drawerHovered = false;
  }

  onRowMenuOpened(): void {
    this.rowMenuOpen = true;
  }

  // Fires both when an item is selected and when the menu is dismissed by
  // clicking off it - in both cases the user was just interacting with the
  // drawer, so treat that as "still hovered" rather than collapsing right
  // out from under them. A genuine subsequent mouseleave (the user
  // actually moving away afterward) still collapses it normally.
  onRowMenuClosed(): void {
    this.rowMenuOpen = false;
    this.drawerHovered = true;
  }

  toggleDrawerPin(): void {
    if (!this.currentUser?.id) {
      return;
    }

    const next = !this.isDrawerPinned;
    const previousUser = this.currentUser;
    this.currentUser = { ...this.currentUser, drawerPinned: next };

    this.adminUserService.update(this.currentUser.id, this.currentUser).catch((err) => {
      console.error('Failed to save drawer pin state:', err);
      this.currentUser = previousUser;
    });
  }

  logOff(): void {
    this.authService.logOut();
  }

  get displayName(): string {
    const name = [this.currentUser?.firstName, this.currentUser?.lastName].filter(Boolean).join(' ');
    return name || this.currentUser?.email || '';
  }

  private syncActiveFromUrl(url: string): void {
    const [path, queryString] = url.split('?');
    const segment = path.split('/').filter(Boolean)[0] ?? '';
    const group = NAV_CONFIG.find((g) => g.id === segment);

    this.activeGroupId = group ? group.id : null;

    if (group?.items) {
      this.activeSlug = new URLSearchParams(queryString ?? '').get('tab');
      if (this.activeGroupId) {
        this.expanded.add(this.activeGroupId);
      }
    } else {
      this.activeSlug = null;
    }
  }
}
