import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
// Auth comes from @angular/fire/auth (an injectable DI-provided instance,
// see app.module.ts's provideAuth()), not a raw getAuth() call - see this
// class's constructor for why.
import { Auth } from '@angular/fire/auth';
import { AuthProvider, browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail,
  setPersistence, signInWithEmailAndPassword, signInWithPopup, signOut, updatePassword, User, UserCredential } from 'firebase/auth';
import { BehaviorSubject, Observable, ReplaySubject, fromEventPattern, of } from 'rxjs';
import { map, mergeMap, share, shareReplay } from 'rxjs/operators';
import { AdminUser } from '../models/admin/admin-user.model';
import { AdminUserService } from '../services/data/admin-user.service';
import { CookieService } from 'ngx-cookie-service';
import { QueryParam, WhereFilterOperandKeys } from './firebase.dao';
import { notify } from '../utils/notify.util';

const AUTH_COOKIE_NAME = 'crm_auth';
const USER_COOKIE_NAME = 'crm_user';
const ID_TOKEN_COOKIE_NAME = 'crm_token';

@Injectable({
  providedIn: 'root'
})
export class FireAuthDao {
  public authSate$ = new BehaviorSubject<boolean>(false);
  public currentUser$: Observable<User>;
  public loggedInUser$: Observable<AdminUser | undefined>;

  public currentAgent$ = new BehaviorSubject<AdminUser | undefined>(undefined);

  constructor(
    public auth: Auth,
    public router: Router,
    public ngZone: NgZone,
    public userService: AdminUserService,
    private cookieService: CookieService
  ) {
    this.authSate$.next(this.cookieService.check(ID_TOKEN_COOKIE_NAME));

    // shareReplay(1), not share() - a raw Firebase auth-state change never
    // itself "errors" (onAuthStateChanged's callback doesn't throw), so
    // there's no error-caching risk here the way there was on loggedInUser$
    // below; this should just be one single, permanent, app-wide
    // subscription. That matters for a subtle but real bug this used to
    // have: without a share operator here, currentUser$ is a cold
    // observable - every subscriber (re)registers its own onAuthStateChanged
    // listener with Firebase. loggedInUser$'s own retry() used to sit AFTER
    // mergeMap in the pipe below, so every retry attempt resubscribed to
    // this WHOLE chain, including currentUser$ - tearing down and
    // re-registering a brand new onAuthStateChanged listener (which fires
    // immediately with the current state) on every single retry. Live-
    // diagnosed as the "auth state changed!" log firing 5 times on one
    // page load: that log actually sits in fromEventPattern's *unsubscribe*
    // callback below, so 5 firings meant 5 teardown/reattach cycles, not 5
    // real auth changes. Sharing this stream fixes it at the root - see the
    // retry removed from loggedInUser$'s own pipe for the other half.
    this.currentUser$ = fromEventPattern<User>(
      (handler) => this.auth.onAuthStateChanged(handler),
      (_handler, unsubscribe) => unsubscribe()
    ).pipe(shareReplay(1));

    this.loggedInUser$ = this.currentUser$.pipe(
      mergeMap((user: User) => {
        // onAuthStateChanged's very first emission on a fresh page load
        // (e.g. landing on /login with no session) is null, not a User -
        // querying `user.email` unconditionally here used to throw
        // synchronously right into this shared pipe on every single
        // signed-out page load (live-diagnosed via a console TypeError on
        // /login before any credentials were even entered). Signed-out is
        // a real, valid state this stream needs to represent, not an
        // error - short-circuit to it here instead of ever touching
        // `user.email` when there's no user.
        if (!user) {
          return of(null);
        }

        const qp: QueryParam[] = [];
        qp.push(new QueryParam('email', WhereFilterOperandKeys.equal, user.email));
        // No retry() here anymore - FirebaseDAO.getAllByValue() (which this
        // calls into) already retries the read itself with the same
        // jittered backoff, entirely inside this one Promise, without
        // touching currentUser$ at all. A retry() at this pipe level used
        // to duplicate that (redundant on top of the DAO's own retries) and
        // caused the resubscription storm explained above - see this
        // constructor's currentUser$ comment.
        return this.userService.getAllByValue('email', user.email);
      }),
      map((users) => {
        // Signed out (see the mergeMap guard above) - distinct from "a
        // real Firebase Auth user with no matching admin_users record"
        // below, which logs out and throws; here there was never a
        // session to begin with, so there's nothing to log out of and no
        // error to raise.
        if (users === null) {
          return undefined;
        }

        if (!Array.isArray(users) || users?.length > 1) {
          throw new Error('More than 1 user found with this email address');
        }

        if (!users[0]) {
          this.logOut();

          throw new Error('No Record Found');
        } else {
          this.currentAgent$.next(users[0]);
        }

        return users[0];
      }),
      // share(), not shareReplay(1) - shareReplay caches an error
      // permanently (its ReplaySubject completes with error and is never
      // replaced), so if getAllByValue() fails under a bad enough cold-load
      // collision, every subscriber for the rest of that
      // page's life - every nav render, every route guard, every manager
      // screen - gets that same stale error forever, with no way to recover
      // short of a full reload. resetOnError tears the connector down on
      // error so the next subscriber re-subscribes to the source fresh
      // (getting its own fresh getAllByValue() call) instead of replaying a
      // dead result. Since
      // currentUser$ above is its own separately-shared stream now, this
      // reset only re-runs the mergeMap/map stage, not the whole auth
      // listener - no more resubscription storm.
      share({ connector: () => new ReplaySubject(1), resetOnError: true, resetOnComplete: false, resetOnRefCountZero: false })
    );

    // `userPermissions$` was built here until 2026-09-01, from a
    // UserPermissionService reading a `user_permissions` collection.
    //
    // NOTHING EVER SUBSCRIBED TO IT, the collection has never existed in
    // either project, and the service's two questions
    // (isUserPermittedinCRM / isUserPermittedinAdminApp) were never asked.
    // It is the shape of an older permission system that was replaced and
    // not removed - the live one is PermissionService over the nav-config
    // screen registry - and it made this authentication DAO depend on a
    // service it did not use.
  }

  public signIn(email: string, password: string): Promise<UserCredential> {
    this.auth.onAuthStateChanged((user) => {
      this.authSate$.next(!!user);
      if (!user) {
        this.cookieService.delete(AUTH_COOKIE_NAME);
        this.cookieService.delete(USER_COOKIE_NAME);
        this.cookieService.delete(ID_TOKEN_COOKIE_NAME);
      }
    });

    return setPersistence(this.auth, browserLocalPersistence).then(() => {
      return signInWithEmailAndPassword(this.auth, email, password);
    });
  }

  public authLogin(provider: AuthProvider): Promise<UserCredential> {
    return setPersistence(this.auth, browserSessionPersistence).then(() => {
      return signInWithPopup(this.auth, provider);
    });
  }

  public register(email: string, password: string) {
    return createUserWithEmailAndPassword(this.auth, email, password)
      .then((userCredentials) => {
        sendEmailVerification(userCredentials.user);
        setPersistence(this.auth, browserSessionPersistence);
        return userCredentials;
      })
      .catch((error) => {
        throw error;
      });
  }

  public async logOut() {
    try {
      await this.router.navigate(['/login']);
      await signOut(this.auth);
    } catch (error) {
      console.error('Error in Auth Service.', error);
    }
  }

  public forgotPassword(passwordResetEmail: string) {
    return sendPasswordResetEmail(this.auth, passwordResetEmail);
  }

  public resetPassword(newPassword: string) {
    if(this.auth.currentUser){
      updatePassword(this.auth.currentUser, newPassword).then(() => {
        notify({
          message: 'Password Successfully changed.',
          position: 'top',
          type: 'success'
        });

        return true;
      }).catch(function (error) {
        notify({
          message: error,
          position: 'top',
          type: 'error'
        });

        return false;
      });

    }
  }
}
