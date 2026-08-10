import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subject, filter, takeUntil } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { hasRole } from 'src/app/common/lists/roles.enum';
import { NAV_CONFIG, NavGroup } from './nav-config';

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

  private ngUnsubscribe = new Subject<void>();

  constructor(private authService: AdminAuthService, private router: Router) {}

  ngOnInit(): void {
    // Was: this.authService.getLoggedInUser().role, which reads the
    // "impact-disciples-user" cookie - see this component's git history for
    // the full explanation of why that can be null (a valid Firebase
    // session with a stale/expired cookie). dao.loggedInUser$ re-derives
    // the AdminUser from Firebase's own live auth state instead.
    this.authService.dao.loggedInUser$.pipe(takeUntil(this.ngUnsubscribe)).subscribe((user) => {
      this.currentUser = user;
      this.secureNav = NAV_CONFIG
        .filter((group) => hasRole(user?.role, group.roles))
        .map((group) => ({
          ...group,
          items: group.items?.filter((item) => !item.roles || hasRole(user?.role, item.roles))
        }));
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

  toggleGroup(id: string): void {
    if (this.expanded.has(id)) {
      this.expanded.delete(id);
    } else {
      this.expanded.add(id);
    }
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
