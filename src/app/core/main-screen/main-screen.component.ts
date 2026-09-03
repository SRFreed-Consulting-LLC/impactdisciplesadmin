import { afterNextRender, Component, Injector, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSidenavContainer } from '@angular/material/sidenav';
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
import { hasRole, Role } from '@impact-common/shared/lists/roles.enum';
import {
  NAV_CONFIG, NAV_SECTIONS, NavGroup, NavLeaf, NavSection, NavSectionDef,
  keepsNavGroup, sectionOf
} from './nav-config';
import { SitePagesNavService } from 'src/app/page-manager/pages/site-pages-nav.service';

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

  // Which drawer TAB is showing - Admin / Site / Library, see nav-config's
  // NAV_SECTIONS. Deliberately NOT persisted: the URL decides it (see
  // syncActiveFromUrl), so a bookmarked /page-manager?tab=give always opens
  // on the tab that screen lives on rather than on whichever one was last
  // clicked. A saved preference would have to lose that argument every time
  // the two disagreed.
  activeSection: NavSection = 'admin';

  // MatDrawerContainer recomputes the content pane's left margin on drawer
  // open/close and mode changes - NOT when the drawer's width changes under
  // it, which is exactly what dragging the resize handle does. Without an
  // explicit updateContentMargins() the drawer would widen and the content
  // would stay where it was, overlapped. See onResizeMove.
  @ViewChild(MatSidenavContainer) private shell?: MatSidenavContainer;

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

  // Which manager group is currently open. ACCORDION-EXCLUSIVE since
  // 2026-08-29 (owner's call): opening one closes the last, so the nav never
  // grows past the window and the sub-items on screen always belong to one
  // manager. Still a Set rather than a nullable string - openGroup() is the
  // single place that enforces the rule, and the template's
  // `expanded.has(id)` reads the same either way.
  //
  // A group is also opened whenever navigation lands on it (left nav click,
  // the new-record-alerts bell, or a bookmarked URL), so arriving at a
  // manager always shows its own sub-items without an extra click - that
  // path goes through openGroup() too, or navigating would leave the
  // previous group open beside the new one.
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
    private router: Router,
    // CONSTRUCTOR-injected on purpose, against the house preference for
    // inject(): this class is constructor-injected throughout and two specs
    // build it with `new` and duck-typed deps. An inject() field here would
    // throw NG0203 in both the moment they do. Converting the whole class is
    // its own piece of work, not something to smuggle into this change.
    // Needed for afterNextRender - see reSyncContentMargin().
    private injector: Injector,
    // The pages staff created, as leaves under Page Manager - see
    // navItemsFor(). Constructor-injected for the same NG0203 reason above.
    private sitePagesNav: SitePagesNavService
  ) {}

  /** Re-measures the drawer AFTER Angular has flushed the DOM.
   *
   *  Material only recomputes the content pane's left margin on open/close,
   *  mode and direction changes, and window resize - never on a WIDTH change
   *  (there is no ResizeObserver in its sidenav). The drawer is
   *  position:absolute, so its width contributes nothing to layout and that
   *  margin is the ONLY thing holding the content clear of it. Every path
   *  that changes the width therefore has to ask for this by hand.
   *
   *  It must run post-render: updateContentMargins() reads offsetWidth, and
   *  a synchronous call would re-measure the width the drawer had BEFORE the
   *  binding was applied. */
  private reSyncContentMargin(): void {
    // No container yet means the view has not been created, and Material has
    // not measured anything to be wrong about - the first render will pick
    // up whatever width is bound by then. This is also what keeps the
    // hand-constructed specs off afterNextRender, which needs a real
    // injector.
    if (!this.shell) {
      return;
    }
    afterNextRender({ read: () => this.shell?.updateContentMargins() }, { injector: this.injector });
  }

  ngOnInit(): void {
    // Was: this.authService.getLoggedInUser().role, which reads the
    // "impact-disciples-user" cookie - see this component's git history for
    // the full explanation of why that can be null (a valid Firebase
    // session with a stale/expired cookie). dao.loggedInUser$ re-derives
    // the AdminUser from Firebase's own live auth state instead.
    this.authService.dao.loggedInUser$.pipe(takeUntil(this.ngUnsubscribe)).subscribe((user) => {
      // The saved drawerWidth arrives HERE, not at construction - the
      // component renders first (this stream does a Firestore lookup on top
      // of the auth state), so the drawer is laid out at the 300px default
      // and Material measures it there. When a wider saved width then lands,
      // nothing tells Material to re-measure and the drawer paints over the
      // left of every screen - including over the resize handle, so there is
      // no way to drag it back. See reSyncContentMargin().
      const widthBefore = this.drawerWidth;
      this.currentUser = user;
      if (this.drawerWidth !== widthBefore) {
        this.reSyncContentMargin();
      }
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
        //
        // PAGE MANAGER IS THE EXCEPTION, and it has to be: since Web Config
        // moved to Data on 2026-08-31 it declares NO static items at all -
        // every one of its leaves is a page streamed from page_content by
        // SitePagesNavService, and those are merged later, in navItemsFor().
        // Judged on its static list alone it looks empty and would vanish
        // from the nav entirely, taking every page with it.
        //
        // The rule lives in nav-config.ts so a spec can call it. As an
        // inline predicate here it decided whether a whole area of the app
        // was reachable and nothing could check it.
        .filter((group) => keepsNavGroup(group));

      this.rebuildPinnedItems();
      this.ensureSectionVisible();
    });

    // The top bar shows the signed-in person's name, and Settings > My
    // Profile is where they change it - but loggedInUser$ above is a
    // one-read-per-auth-change stream, so nothing would refresh the greeting
    // until their next sign-in. ONLY the two name fields are copied across:
    // currentAgent$ is fed at sign-in and is stale with respect to any
    // preference written since, so taking the whole record here would revert
    // the drawer width or the theme the moment a name was saved.
    this.authService.dao.currentAgent$.pipe(takeUntil(this.ngUnsubscribe)).subscribe((agent) => {
      if (!agent || !this.currentUser) {
        return;
      }
      this.currentUser = {
        ...this.currentUser,
        firstName: agent.firstName,
        lastName: agent.lastName
      };
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
    // A drag in progress when the shell is torn down would otherwise leave
    // two live window listeners holding a reference to this component.
    this.stopResizeListening();
  }

  // ---- Drawer sections (Admin / Site / Library) ----

  /** Only tabs that have something on them. An Employee granted nothing
   *  under Page Manager should not be offered an empty Site tab, and a
   *  Role.EDITOR - hard-scoped to Library by PermissionService - sees no
   *  tab strip at all, because there is nothing to switch between. */
  get visibleSections(): NavSectionDef[] {
    return NAV_SECTIONS.filter((section) => {
      // The TAB-LEVEL role gate (2026-08-30). Presentation only - the real
      // refusal is in PermissionService.canView(), which this cannot be
      // trusted to do because hiding a row does not stop a typed URL.
      if (section.roles && !hasRole(this.currentUser?.role, section.roles)) {
        return false;
      }
      return this.secureNav.some((group) => sectionOf(group) === section.id);
    });
  }

  // One tab is not a choice - render the nav on its own rather than a
  // segmented control with a single segment nobody can move off.
  get showSectionTabs(): boolean {
    return this.visibleSections.length > 1;
  }

  /** The groups on the tab currently showing. Filtered from secureNav, so
   *  the object identities are stable across change detection and the
   *  template's `track group` keeps working. */
  get sectionNav(): NavGroup[] {
    return this.secureNav.filter((group) => sectionOf(group) === this.activeSection);
  }

  /**
   * A group's leaves as the drawer draws them.
   *
   * For Page Manager that is the static list PLUS every page staff have
   * created (Shane's call, 2026-08-30: no difference between the pages -
   * each one is a leaf, clicking it opens its editor). The created pages
   * cannot be in nav-config.ts because that file is code and they are data;
   * they stream in from `page_content` instead, appearing the moment a page
   * is created and vanishing when it is deleted, with no reload.
   *
   * Appended AFTER the static items, so the fixed screens (Home, Pages,
   * the twelve, Web Config...) keep their positions and the created pages
   * read as one alphabetical run.
   * @param {NavGroup} group The group being rendered.
   * @return {NavLeaf[]} Its leaves, extended for page-manager only.
   */
  navItemsFor(group: NavGroup): NavLeaf[] {
    const items = group.items ?? [];
    if (group.id !== 'page-manager' || !this.sitePagesNav.leaves.length) {
      return items;
    }
    // A created page whose slug collides with a static leaf is not listed
    // twice - the static one wins, since it is the one the router and the
    // permission registry know.
    //
    // Streamed leaves go through the SAME grant check the static ones did in
    // secureNav above (canViewNavItem). Until 2026-09-03 the Site tab was
    // Admin/Root only, so nobody who reached this line could be denied a
    // page; an Employee granted a single page can now, and must see only it.
    const taken = new Set(items.map((item) => item.slug));
    return [
      ...items,
      ...this.sitePagesNav.leaves.filter(
        (leaf) => !taken.has(leaf.slug) && this.permissionService.canViewNavItem(group, leaf)
      )
    ];
  }

  // Library renders as one flat list with no group header - the tab already
  // says LIBRARY, so a LIBRARY row under it says it twice. See
  // NavSectionDef.flatten.
  get isSectionFlattened(): boolean {
    // Only while the drawer is EXPANDED. Flattening drops the group header,
    // and that header's icon is the only thing a 64px rail can draw - a
    // NavLeaf has no icon of its own, so the collapsed rules hide the flat
    // list and nothing takes its place. On a flattened section that left the
    // rail completely blank: the whole nav disappeared. Collapsed, fall back
    // to the group-header row every other section already renders there;
    // hovering expands and swaps back to the flat list.
    return this.drawerExpanded
      && NAV_SECTIONS.find((section) => section.id === this.activeSection)?.flatten === true;
  }

  /** The groups to render as expandable headers - empty on a flattened
   *  section, whose screens come through flatItems instead. Two getters
   *  rather than one branch in the template, so neither list can ever draw
   *  at the same time as the other. */
  get groupedNav(): NavGroup[] {
    return this.isSectionFlattened ? [] : this.sectionNav;
  }

  /** A flattened section's screens, already paired with their owning group
   *  so pinning, permissions and routing all still work off the real group
   *  id - flattening is a rendering choice, not a change of identity. */
  get flatItems(): PinnedNavItem[] {
    return this.sectionNav.flatMap((group) => (group.items ?? []).map((item) => ({ group, item })));
  }

  selectSection(section: NavSection): void {
    this.activeSection = section;
  }

  /** Pinned shortcuts sit on the FIRST tab (owner's call: Home and the pins
   *  live under Admin, not floating above the tab strip). Expressed as
   *  "first visible section" rather than a literal 'admin' so a Role.EDITOR
   *  - who has no Admin tab at all - still gets their pins, on the only tab
   *  they have. For everyone else the two are the same thing. */
  get showPinnedItems(): boolean {
    return this.activeSection === this.visibleSections[0]?.id;
  }

  /** Keeps the drawer off a tab with nothing on it. Only fires when the
   *  current tab is genuinely empty, so it can never override a section the
   *  URL just chose. */
  private ensureSectionVisible(): void {
    // secureNav is still empty on the FIRST call, from ngOnInit's own
    // syncActiveFromUrl - the auth emission is async, so every section looks
    // empty at that point. Bailing out keeps a deep-linked
    // /page-manager?tab=give on Site instead of snapping it to the 'admin'
    // fallback; the auth emission calls this again and settles it for real.
    if (this.visibleSections.length === 0) {
      return;
    }
    if (!this.visibleSections.some((section) => section.id === this.activeSection)) {
      this.activeSection = this.visibleSections[0].id;
    }
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
      // Collapsing the open group leaves NOTHING open, deliberately: a group
      // that springs back the moment you close it reads as broken, and
      // navigation reopens the right one anyway.
      this.expanded.clear();
    } else {
      this.openGroup(id);
    }
  }

  /** Opens one group and closes any other - the accordion rule, in one place
   *  so navigation and clicking cannot disagree about it. */
  private openGroup(id: string): void {
    this.expanded.clear();
    this.expanded.add(id);
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

  // Gates the user-menu dropdown's "E2E Dashboard" link. ROOT ONLY, which
  // is stricter than every other item in that menu - isFullAccess() is
  // Admin-or-Root (Root inherits Admin), so an Admin sees Logs and Admin
  // Users but must NOT see this. Asked for explicitly: it reports on the
  // test estate, not on the business, and it is not an operational screen.
  //
  // Root is a single manually-assigned account and is deliberately not
  // assignable from the UI (see roles.enum.ts), so this is an exact-role
  // check rather than a permission grant.
  get canViewE2eDashboard(): boolean {
    return this.currentUser?.role === Role.ROOT;
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

    // PARTIAL write - see the note in onResizeEnd. This used to send the
    // whole record, which meant a pin toggle carried this component's cached
    // copy of every other field back to Firestore and clobbered anything
    // ThemeService had written from ITS cached copy since login.
    this.adminUserService.updateFields(this.currentUser.id, { pinnedScreens: next }).catch((err) => {
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
    return this.isDrawerPinned || this.drawerHovered || this.rowMenuOpen || this.resizing;
  }

  // ---- Drag-to-resize ----
  //
  // The drawer's width is the user's, dragged from the seam between it and
  // the content and saved to their admin_users record (see
  // AdminUser.drawerWidth). Asked for because the longest screen names
  // ("Disciple Making Minute", "Coaching with Impact") were being clipped at
  // the old fixed 260px, and the right width depends on the screen you are
  // sitting at.
  //
  // Bounds are enforced on BOTH read and write, not just at the handle: the
  // value round-trips through Firestore, and a hand-edited doc must not be
  // able to produce a drawer too narrow to read or one that swallows the
  // content pane.
  readonly minDrawerWidth = 240;
  readonly maxDrawerWidth = 520;
  private readonly defaultDrawerWidth = 300;

  // Public because the template needs it for the resizing class and the
  // handle's own active state.
  resizing = false;

  private resizeStartX = 0;
  private resizeStartWidth = 0;

  // The width mid-drag. Kept separate from currentUser.drawerWidth so the
  // drag is local and Firestore is written ONCE, on release - a write per
  // pointermove would be hundreds of writes per drag.
  private draggedWidth: number | null = null;

  get drawerWidth(): number {
    return this.draggedWidth ?? this.clampWidth(this.currentUser?.drawerWidth ?? this.defaultDrawerWidth);
  }

  private clampWidth(px: number): number {
    return Math.min(this.maxDrawerWidth, Math.max(this.minDrawerWidth, Math.round(px)));
  }

  onResizeStart(event: PointerEvent): void {
    // Stops the drag selecting the nav's text as the pointer sweeps over it.
    event.preventDefault();
    this.resizing = true;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.drawerWidth;
    // On WINDOW, not the handle: the pointer routinely outruns a 6px strip,
    // and a drag that stops tracking the moment it leaves the handle reads
    // as the drawer randomly sticking.
    window.addEventListener('pointermove', this.onResizeMove);
    window.addEventListener('pointerup', this.onResizeEnd);
    window.addEventListener('pointercancel', this.onResizeEnd);
  }

  // Arrow PROPERTIES, not methods: they go through addEventListener, which
  // needs both a bound `this` and the identical reference back at
  // removeEventListener time.
  private onResizeMove = (event: PointerEvent): void => {
    if (!this.resizing) {
      return;
    }
    this.draggedWidth = this.clampWidth(this.resizeStartWidth + (event.clientX - this.resizeStartX));
    // See the `shell` field's own comment - Material does not watch the
    // drawer's width, so without this the content pane keeps the margin it
    // had when the drag started.
    this.shell?.updateContentMargins();
  };

  private onResizeEnd = (): void => {
    if (!this.resizing) {
      return;
    }
    this.resizing = false;
    this.stopResizeListening();

    const width = this.draggedWidth;
    this.draggedWidth = null;
    if (width === null || !this.currentUser?.id || width === this.currentUser.drawerWidth) {
      // A click on the handle that never moved, or no change to save - but
      // the margin still has to settle, because every pointermove measured
      // the width from the frame BEFORE its own binding was applied and so
      // ended one move short.
      this.reSyncContentMargin();
      return;
    }

    // Optimistic with a revert on failure, same as togglePin/toggleDrawerPin
    // - loggedInUser$ is a one-time read per auth change, so nothing would
    // re-pull this on its own.
    const previousUser = this.currentUser;
    this.currentUser = { ...this.currentUser, drawerWidth: width };
    this.reSyncContentMargin();
    // PARTIAL write, not the whole record. update() is a full setDoc with no
    // merge, so a preference write carried a stale copy of every other field
    // - and ThemeService writes the same doc the same way off its OWN cached
    // copy, so the two silently erased each other's fields (a theme change
    // after a drag reverted the width, and vice versa). Dragging makes this
    // by far the most frequent write to admin_users, which is what turned a
    // latent bug into a reliable one.
    this.adminUserService.updateFields(this.currentUser.id, { drawerWidth: width }).catch((err) => {
      console.error('Failed to save drawer width:', err);
      this.currentUser = previousUser;
      this.reSyncContentMargin();
    });
  };

  private stopResizeListening(): void {
    window.removeEventListener('pointermove', this.onResizeMove);
    window.removeEventListener('pointerup', this.onResizeEnd);
    window.removeEventListener('pointercancel', this.onResizeEnd);
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

    // PARTIAL write - see the note in onResizeEnd.
    this.adminUserService.updateFields(this.currentUser.id, { drawerPinned: next }).catch((err) => {
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

    // The tab follows the URL, so a bookmarked or deep-linked screen opens
    // on the tab that actually holds it instead of showing a nav the
    // current screen is not in. Left alone when the URL is not a nav group
    // at all (/settings, /dashboard) - those belong to no tab, and yanking
    // the drawer back to Admin on the way to Settings would be noise.
    if (group) {
      this.activeSection = sectionOf(group);
      // The section comes from the UNFILTERED registry, so the URL can point
      // at a tab this user has nothing on - the new-record bell sends
      // everyone to a group on Admin, and an Employee scoped to Page Manager
      // (or an Editor, scoped to Library) has no Admin tab. Left alone the
      // drawer renders EMPTY, and because showSectionTabs hides the strip
      // for a one-tab user there is no control left to get back with; only a
      // page reload recovers. ensureSectionVisible is a no-op whenever the
      // section is a real one, so this costs nothing in the normal case.
      this.ensureSectionVisible();
    }

    if (group?.items) {
      this.activeSlug = new URLSearchParams(queryString ?? '').get('tab');
      if (this.activeGroupId) {
        this.openGroup(this.activeGroupId);
      }
    } else {
      this.activeSlug = null;
    }
  }
}
