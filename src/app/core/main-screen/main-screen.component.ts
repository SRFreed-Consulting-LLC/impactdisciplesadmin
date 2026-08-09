import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { Role } from 'impactdisciplescommon/src/lists/roles.enum';
import { SecureMenuItem } from 'impactdisciplescommon/src/models/utils/secure-menu-item.model';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';

// Material icon ligatures, keyed by path since two nav entries shared the
// same DevExtreme icon name ("user") for genuinely different things - a
// copy-paste artifact (Store Manager) fixed here rather than ported.
const NAV_ICONS: Record<string, string> = {
  home: 'home',
  'admin-manager': 'admin_panel_settings',
  'events-manager': 'event',
  'requests-manager': 'notifications_none',
  'store-manager': 'storefront',
  'subscriptions-manager': 'mail',
  'web-manager': 'handyman'
};

@Component({
    selector: 'app-main-screen',
    templateUrl: './main-screen.component.html',
    styleUrls: ['./main-screen.component.scss'],
    standalone: false
})
export class MainScreenComponent implements OnInit, OnDestroy {
  navigation: SecureMenuItem[] = [
    { id: 0, text: "HOME", icon: "home", path:"home", users:[Role.ADMIN] },
    { id: 1, text: "ADMIN MANAGER", icon: "user", path: "admin-manager", users:[Role.ADMIN] },
    { id: 2, text: "EVENTS MANAGER", icon: "event", path: "events-manager", users:[Role.ADMIN, Role.EMPLOYEE] },
    { id: 3, text: "REQUESTS MANAGER", icon: "belloutline", path: "requests-manager", users:[Role.ADMIN] },
    { id: 4, text: "STORE MANAGER", icon: "user", path: "store-manager", users:[Role.ADMIN, Role.EMPLOYEE] },
    { id: 5, text: "SUBSCRIPTIONS MANAGER", icon: "message", path: "subscriptions-manager", users:[Role.ADMIN] },
    { id: 6, text: "WEB MANAGER", icon: "toolbox", path: "web-manager", users:[Role.ADMIN] }
  ]

  secureNav: SecureMenuItem[] = [];

  private ngUnsubscribe = new Subject<void>();

  constructor(private authService: AdminAuthService){}

  ngOnInit(): void {
    // Was: this.authService.getLoggedInUser().role, which reads the
    // "impact-disciples-user" cookie. That cookie's expiration is hard-set
    // to the Firebase ID token's expiration (~1hr) at login time and is
    // never proactively refreshed, while the Firebase session itself
    // silently refreshes far longer than that - so a long-lived session can
    // end up with a valid Firebase auth state (AuthGuardService lets the
    // route through) but a stale/expired cookie. getLoggedInUser() then
    // returns null, `.role` throws mid-ngOnInit, and secureNav is silently
    // left at its empty-array default - an empty nav with everything else
    // (logo, toolbar) still rendering normally.
    //
    // dao.loggedInUser$ re-derives the AppUser record from Firebase's own
    // live auth state on every emission (see FireAuthDao) - no cookie
    // involved, so it can't go stale the same way.
    this.authService.dao.loggedInUser$.pipe(takeUntil(this.ngUnsubscribe)).subscribe((user) => {
      this.secureNav = this.navigation.filter(item => item.users.find(role => role == user?.role));
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  iconFor(item: SecureMenuItem): string {
    return NAV_ICONS[item.path] ?? 'circle';
  }

  logOff(): void {
    this.authService.logOut();
  }
}
