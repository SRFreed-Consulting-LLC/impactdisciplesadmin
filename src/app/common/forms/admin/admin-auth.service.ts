import { Injectable, inject } from '@angular/core';
import { Router, ActivatedRouteSnapshot, CanActivateFn } from '@angular/router';
import { signOut, UserCredential } from 'firebase/auth';
import { FireAuthDao } from '../../dao/fireauth.dao';
import { AdminUser } from '../../models/admin/admin-user.model';
import { CookieService } from 'ngx-cookie-service';
import { catchError, from, map, Observable, of, switchMap, take } from 'rxjs';
import { notify } from 'src/app/common/utils/notify.util';
import { LoggerService } from 'src/app/common/services/data/logger.service';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';
import { describeLoginFailure } from './login-failure';

const defaultPath = '/';

const COOKIE_NAME = "impact-disciples-user"

export interface LoginResult {
  isOk: boolean;
  data: AdminUser | null;
  message: string;
}

export interface ResetPasswordResult {
  isOk: boolean;
  message?: string;
}

// R2: this literal appeared six times in logIn() alone. Every failure the
// method can produce is indistinguishable to the caller by design - the
// login screen must not tell an attacker which half of the pair was wrong.
const AUTHENTICATION_FAILED: LoginResult = {
  isOk: false,
  data: null,
  message: 'Authentication failed'
};

@Injectable({
  providedIn: 'root'
})
// NOTE: no code path in this app creates a new Admin User's Firebase Auth
// account anymore - the old self-service "Create Account" screen (findUser()
// routing to it when an admin_users record had no firebaseUID yet) was
// removed in favor of a single-step login screen, matching
// impact-discipleship-library-manager-new. A newly-added Admin User
// currently has no way to set their first password themselves; provisioning
// their Firebase Auth account (e.g. via the Firebase Console) is an open
// follow-up, not handled by this app.
export class AdminAuthService {
  public user: AdminUser;

  constructor(
    private router: Router,
    public dao: FireAuthDao,
    public userService: AdminUserService,
    private cookieService: CookieService,
    public loggerService: LoggerService,
  ) { }

  logIn(email: string, password: string): Observable<LoginResult> {
    this.cookieService.delete(COOKIE_NAME);

    return from(this.dao.signIn(email.toLowerCase(), password)).pipe(
      switchMap((result: UserCredential) => {
        // R2: guard clauses instead of the old five-deep nest. Firebase
        // resolving without a user, and an email that does not resolve to
        // exactly one admin_users row, are both "not signed in" - there is
        // nothing to distinguish for the caller.
        if (!result.user) {
          return of(AUTHENTICATION_FAILED);
        }

        return from(this.userService.getAllByValue('email', email)).pipe(
          switchMap((users) => {
            // Exactly one: a duplicate admin_users row for one address is
            // ambiguous about which profile the session should carry, so
            // it is refused rather than guessed at.
            if (users?.length !== 1) {
              return of(AUTHENTICATION_FAILED);
            }
            return from(result.user.getIdTokenResult()).pipe(
              map((token) => this.startSession(users[0], token.expirationTime))
            );
          })
        );
      }),
      // R2: one failure path, not four copy-pasted ones. Which message
      // belongs to which auth error code lives in login-failure.ts, where
      // it is a pure function and actually testable - see that file for
      // the three drifts this consolidation corrected.
      catchError((err: { code?: string }) => this.reportLoginFailure(email, err))
    );

  }

  /**
   * Adopts the signed-in admin as the current session: caches the profile,
   * writes the display cookie, and navigates on.
   *
   * The cookie is display/profile caching ONLY and is not proof of
   * authentication - authGuard checks Firebase's own session state. See its
   * SECURITY comment.
   */
  private startSession(user: AdminUser, expirationTime: string): LoginResult {
    this.user = user;
    this.user['cookie_expiration_time'] = Date.parse(expirationTime);

    // Was a three-branch switch on environment.application. That key is the
    // literal "admin" in all five env files, so branches two and three were
    // copy-paste residue from the library/reader app - and the final else
    // navigated to 'profile', which is not a registered route here. Removed
    // 2026-08-28 (sweep D2) along with the env key, which had no other
    // consumer.
    this.router.navigate([this._lastAuthenticatedPath]);

    this.cookieService.set(
      COOKIE_NAME,
      JSON.stringify(this.user),
      { expires: this.user['cookie_expiration_time'] }
    );

    return {
      isOk: true,
      data: this.user,
      message: 'Authentication success'
    };
  }

  /**
   * Records a failed sign-in and tells the user what happened.
   *
   * errorLogs is the ground truth for who is struggling to sign in, so the
   * log line describes the FAULT while the on-screen message describes the
   * remedy - they are deliberately different strings.
   */
  private reportLoginFailure(
    email: string,
    err: { code?: string }
  ): Observable<LoginResult> {
    const failure = describeLoginFailure(err?.code, email);

    return this.loggerService
      .logMessage('LOGIN', email, failure.log, [{ ...err }])
      .pipe(
        switchMap((reference: string | boolean) => {
          notify({
            message: failure.message(reference),
            position: 'top',
            type: 'error'
          });
          return of(AUTHENTICATION_FAILED);
        })
      );
  }

  setUser(user: AdminUser): Observable<AdminUser> {
    const cookieValue = this.cookieService.get(COOKIE_NAME);

    try {
      if (cookieValue) {
        const currentUser = JSON.parse(cookieValue);

        this.cookieService.set(COOKIE_NAME, JSON.stringify(user), { expires: currentUser['cookie_expiration_time'] });

        this.user = user;
      } else {
        this.cookieService.set(COOKIE_NAME, JSON.stringify(user), { expires: 3 });

        this.user = user;
      }
    } catch (error) {
      console.error('Error parsing cookie JSON', error);
    }

    return of(user);
  }

  getLoggedInUser(): AdminUser {
    const cookieValue = this.cookieService.get(COOKIE_NAME);

    let user: AdminUser = null;

    try {
      if (cookieValue) {
        user = JSON.parse(cookieValue);
      } else {
        console.log('cookie not found...expired');
      }
    } catch (error) {
      console.error('Error parsing cookie JSON', error);
    }

    return user;
  }

  resetPassword(email: string): Observable<ResetPasswordResult> {
    // forgotPassword() returns a Promise (sendPasswordResetEmail) - it must
    // actually be awaited/subscribed to, not just called and ignored. The
    // previous version did neither (no await, no .then/.catch, and the
    // surrounding try/catch was synchronous-only so it couldn't have caught
    // a rejection anyway), so it always reported isOk:true immediately,
    // regardless of whether Firebase actually sent the email.
    return from(this.dao.forgotPassword(email)).pipe(
      map(() => ({ isOk: true })),
      catchError((err) => {
        return of({
          isOk: false,
          message: err?.code === 'auth/user-not-found'
            ? `The email address (${email}) is not recognized.`
            : 'Failed to send the password reset email. Please try again.'
        });
      })
    );
  }

  logOut(): void {
    this.user = null;
    this.cookieService.delete(COOKIE_NAME);

    // Was missing the actual Firebase Auth sign-out - AuthGuardService's
    // canActivate check is based on the real Firebase auth state (see the
    // SECURITY comment on that guard), not this cookie, so navigating to
    // /login without signing out first just gets bounced straight back to
    // '/' by the guard, making Log Off look like a no-op.
    signOut(this.dao.auth).finally(() => {
      this.router.navigate(['login']);
    });
  }

  private _lastAuthenticatedPath: string = defaultPath;

  set lastAuthenticatedPath(value: string) {
    this._lastAuthenticatedPath = value;
  }

  get lastAuthenticatedPath(): string {
    return this._lastAuthenticatedPath;
  }
}

// SECURITY: this guard is the access-control boundary for every admin route.
// It MUST be based on the Firebase Auth SDK's own session state (verified
// against Firebase's servers), never on the "impact-disciples-user" cookie
// alone -- that cookie is plain, unsigned JSON written client-side and can
// be forged from devtools (e.g. `document.cookie = "impact-disciples-user=..."`).
// The cookie is still used elsewhere to cache profile data (role, email) for
// display purposes, but it is not trusted here as proof of authentication.
//
// Functional guard (CanActivateFn), not the deprecated class-based
// CanActivate this used to be - inject() is how Angular's functional guards
// receive their dependencies (there's no constructor to inject into, unlike
// every @Component/@Injectable class elsewhere in this app). Logic below is
// unchanged from the old AuthGuardService.canActivate() - only how it's
// declared/registered changed, see app-routing.module.ts's own
// `canActivate: [authGuard]` usage.
export const authGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const authService = inject(AdminAuthService);
  const router = inject(Router);

  const isAuthForm = [
    'login',
    'reset-password'
  ].includes(route.routeConfig?.path || defaultPath);

  return authService.dao.currentUser$.pipe(
    take(1),
    switchMap(user => {
      if (!user) {
        return of(false);
      }

      // Force a refresh check against Firebase so an expired/revoked
      // session can't be reused just because a stale cookie still exists.
      return from(user.getIdTokenResult()).pipe(
        map(token => new Date(token.expirationTime).getTime() > Date.now()),
        catchError(() => of(false))
      );
    }),
    map(isLoggedIn => {
      if (isLoggedIn && isAuthForm) {
        authService.lastAuthenticatedPath = defaultPath;
        router.navigate([defaultPath]);
        return false;
      }

      if (!isLoggedIn && !isAuthForm) {
        console.log('not logged in via Authguard');
        router.navigate(['/login']);
      }

      if (isLoggedIn) {
        authService.lastAuthenticatedPath = route.routeConfig?.path || defaultPath;
      }

      return isLoggedIn || isAuthForm;
    })
  );
};
