import { Injectable } from '@angular/core';
import { Router, ActivatedRouteSnapshot, CanActivate } from '@angular/router';
import { UserCredential } from 'firebase/auth';
import { FireAuthDao } from '../../dao/fireauth.dao';
import { AppUser } from '../../models/admin/appuser.model';
import { CookieService } from 'ngx-cookie-service';
import { catchError, from, map, Observable, of, switchMap, take } from 'rxjs';
import { CustomerModel } from 'src/app/common/models/domain/utils/customer.model';
import { environment } from 'src/environments/environment';
import { notify } from 'src/app/common/utils/notify.util';
import { LoggerService } from 'src/app/common/services/data/logger.service';
import { AppUserService } from 'src/app/common/services/data/user.service';

const defaultPath = '/';

const COOKIE_NAME = "impact-disciples-user"

@Injectable({
  providedIn: 'root'
})
export class AdminAuthService {
  public user: AppUser;

  constructor(
    private router: Router,
    public dao: FireAuthDao,
    public userService: AppUserService,
    private cookieService: CookieService,
    public loggerService: LoggerService,
  ) { }

  findUser(email: string): Observable<AppUser> {
    const user$ = this.userService.getAllByValue('email', email.toLowerCase());

    return from(user$).pipe(
      switchMap(user => {
        if (user.length == 1){
          return of(user[0]);
        } else if(user.length > 1){
          return this.loggerService.logMessage('LOGIN', email, 'More than 1 account was found with the email address (' + email + ')', []).pipe(
            switchMap((ec: any) => {
              notify({
                message: 'More than 1 account was found with this email address (' + email +').' +
                'Correct the Email Address and Try again. If the problem continues, please contact your Admin for assistance with this code: ' + ec,
                position: 'top',
                type: 'error'
              });
              return of(null);
            })
          );
        } else {
          return of(null);
        }
      })
    );
  }

  logIn(email: string, password: string): Observable<any> {
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
            switchMap((ec: any) => {
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
            switchMap((ec: any) => {
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
            switchMap((ec: any) => {
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
            switchMap((ec: any) => {
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

  setUser(user: AppUser): Observable<AppUser> {
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

  getLoggedInUser(): AppUser {
    const cookieValue = this.cookieService.get(COOKIE_NAME);

    let user: AppUser = null;

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

  createAccount(email: string, password: string): Promise<any> {
    return this.dao.register(email.toLowerCase(), password).then(async result => {
      if(result.user){
        const user$ = this.userService.getAllByValue('email', email.toLowerCase());

        return await user$.then(async user => {
          if(user && user.length == 1){
            const u: AppUser | CustomerModel = user[0];

            u.firebaseUID = result.user.uid;

            await this.userService.update(u.id, u as AppUser);

            return {
              isOk: true,
              message: "Account Successfully Created"
            };
          } else {
            return {
              isOk: false,
              message: "More than 1 User Account was found for this email address"
            };
          }
        });
      } else {
        return Promise.reject({
          isOk: false,
          message: "Failed to create account: "
        });
      }
    })
  }

  resetPassword(email: string): Observable<any> {
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

    this.router.navigate(['capture-username-form']);
  }

  get loggedIn(): boolean {
    if(this.cookieService.check(COOKIE_NAME)){
      const user: AppUser =  this.getLoggedInUser()

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
      'reset-password',
      'create-account',
      'change-password/:recoveryCode',
      'capture-username-form',
      'capture-password-form',
      'create-auth-form'
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
          this.router.navigate(['/capture-username-form']);
        }

        if (isLoggedIn) {
          this.authService.lastAuthenticatedPath = route.routeConfig?.path || defaultPath;
        }

        return isLoggedIn || isAuthForm;
      })
    );
  }
}
