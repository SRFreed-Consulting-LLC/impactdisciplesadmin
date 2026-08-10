import { Injectable } from '@angular/core';
import { Router, ActivatedRouteSnapshot, CanActivate } from '@angular/router';
import { signOut, UserCredential } from 'firebase/auth';
import { FireAuthDao } from '../../dao/fireauth.dao';
import { AdminUser } from '../../models/admin/admin-user.model';
import { CookieService } from 'ngx-cookie-service';
import { catchError, from, map, Observable, of, switchMap, take } from 'rxjs';
import { environment } from 'src/environments/environment';
import { notify } from 'src/app/common/utils/notify.util';
import { LoggerService } from 'src/app/common/services/data/logger.service';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';

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
        if(result.user){
          const user$ = this.userService.getAllByValue('email', email);

          return from(user$).pipe(
            switchMap(user => {
              if(user && user.length == 1) {
                return from(result.user.getIdTokenResult()).pipe(
                  map(token => {
                    this.user = user[0];
                    this.user['cookie_expiration_time'] = Date.parse(token.expirationTime);
                    console.log('Expiration:' + new Date(this.user['cookie_expiration_time']));

                    if(environment.application == 'admin'){
                      this.router.navigate([this._lastAuthenticatedPath]);
                    } else if(environment.application == 'book' || environment.application == 'impactdisciples-library'){
                      this.router.navigate(['/home']);
                    } else {
                      this.router.navigate(['profile']);
                    }

                    this.cookieService.set(COOKIE_NAME, JSON.stringify(this.user), { expires: this.user['cookie_expiration_time'] });

                    return {
                      isOk: true,
                      data: this.user,
                      message: "Authentication success"
                    };
                  })
                );

              } else {
                return of({
                  isOk: false,
                  data: null,
                  message: "Authentication failed"
                });
              }
            })
          );
        } else {
          return of({
            isOk: false,
            data: null,
            message: "Authentication failed"
          });
        }
      }),
      catchError((err) => {
        if (err.code == 'auth/wrong-password') {
          return this.loggerService.logMessage('LOGIN', email, 'You have entered an incorrect password for this email address.', [
            { ...err }
          ]).pipe(
            switchMap((ec: string | boolean) => {
              notify({
                message: 'You have entered an incorrect password for this email address. If you have forgotten your password, enter your Email Address ' +
                'and press the "Forgot Password" button. If the problem continues, please contact Alliance Group for assistance with this code: ' + ec,
                position: 'top',
                type: 'error'
              });
              return of({
                isOk: false,
                data: null,
                message: "Authentication failed"
              });
            })
          );
        } else if (err.code == 'auth/user-not-found') {
          return this.loggerService.logMessage('LOGIN', email, 'The email address (' + email + ') is not recognized.', [{ ...err }]).pipe(
            switchMap((ec: string | boolean) => {
              notify({
                message: 'The email address (' +  email + ') is not recognized. Correct the Email Address and Try again. If the problem continues, please contact your Admin for assistance with this code: ' + ec,
                type: 'error'
              });

              return of({
                isOk: false,
                data: null,
                message: "Authentication failed"
              });
            })
          );
        } else if (err.code == 'auth/too-many-requests') {
          return this.loggerService.logMessage('LOGIN', email, 'Too many failed attempts. The account is temporarily locked.', [
            { ...err }
          ]).pipe(
            switchMap((ec: string | boolean) => {
              notify({
                message: 'There have been too many failed logins to this account. Please reset your password by going to the login screen, entering your password, and pressing the "Forgot Password" button. If the problem continues, please contact your Admin for assistance with this code: ' + ec,
                type: 'error'
              });

              return of({
                isOk: false,
                data: null,
                message: "Authentication failed"
              });
            })
          );
        } else {
          return this.loggerService.logMessage('LOGIN', email, 'The email address (' + email + ') is not recognized.', [{ ...err }]).pipe(
            switchMap((ec: string | boolean) => {
              notify({
                message: 'There was an Error accessing your account. Please contact your Admin for Assistance with this code: ' + ec,
                type: 'error'
              });

              return of({
                isOk: false,
                data: null,
                message: "Authentication failed"
              });
            })
          );
        }
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
    try {
      // Send request
      this.dao.forgotPassword(email);
      return of({
        isOk: true
      });
    }
    catch {
      return of({
        isOk: false,
        message: "Failed to reset password"
      });
    }
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

  get loggedIn(): boolean {
    if(this.cookieService.check(COOKIE_NAME)){
      const user: AdminUser =  this.getLoggedInUser()

      if(user){
        const expiration: number = user['cookie_expiration_time'];

        if(expiration - Date.now() < (1000 * 60 * 60)){
          user['cookie_expiration_time'] = expiration + (1000 * 60 * 60);

          this.cookieService.set(COOKIE_NAME, JSON.stringify(user), { expires: user['cookie_expiration_time'] });

          console.log('New Expiration:' + new Date(JSON.parse(this.cookieService.get(COOKIE_NAME))['cookie_expiration_time']));
        }
      }

      return true;
    } else {
      return false;
    }
  }

  private _lastAuthenticatedPath: string = defaultPath;

  set lastAuthenticatedPath(value: string) {
    this._lastAuthenticatedPath = value;
  }

  get lastAuthenticatedPath(): string {
    return this._lastAuthenticatedPath;
  }
}

@Injectable({
  providedIn: 'root'
})
//TODO: See why CanActivate is deprecated and update
export class AuthGuardService implements CanActivate {
  constructor(private router: Router, private authService: AdminAuthService) { }

  // SECURITY: this guard is the access-control boundary for every admin route.
  // It MUST be based on the Firebase Auth SDK's own session state (verified
  // against Firebase's servers), never on the "impact-disciples-user" cookie
  // alone -- that cookie is plain, unsigned JSON written client-side and can
  // be forged from devtools (e.g. `document.cookie = "impact-disciples-user=..."`).
  // The cookie is still used elsewhere to cache profile data (role, email) for
  // display purposes, but it is not trusted here as proof of authentication.
  canActivate(route: ActivatedRouteSnapshot): Observable<boolean> {
    const isAuthForm = [
      'login',
      'reset-password',
      'change-password/:recoveryCode'
    ].includes(route.routeConfig?.path || defaultPath);

    return this.authService.dao.currentUser$.pipe(
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
          this.authService.lastAuthenticatedPath = defaultPath;
          this.router.navigate([defaultPath]);
          return false;
        }

        if (!isLoggedIn && !isAuthForm) {
          console.log('not logged in via Authguard');
          this.router.navigate(['/login']);
        }

        if (isLoggedIn) {
          this.authService.lastAuthenticatedPath = route.routeConfig?.path || defaultPath;
        }

        return isLoggedIn || isAuthForm;
      })
    );
  }
}
