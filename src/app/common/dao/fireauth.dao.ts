import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { Auth, browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, getAuth, sendEmailVerification, sendPasswordResetEmail,
  setPersistence, signInWithEmailAndPassword, signInWithPopup, signOut, updatePassword, User, UserCredential } from 'firebase/auth';
import { BehaviorSubject, Observable, fromEventPattern } from 'rxjs';
import { UserPermissionService } from '../services/data/user-permissions.service';
import { Firestore } from '@angular/fire/firestore';
import { map, mergeMap, retry, shareReplay } from 'rxjs/operators';
import { UserPermission } from '../models/admin/user-permission.model';
import { AdminUser } from '../models/admin/admin-user.model';
import { AdminUserService } from '../services/data/admin-user.service';
import { CookieService } from 'ngx-cookie-service';
import { QueryParam, WhereFilterOperandKeys, retryDelay } from './firebase.dao';
import { notify } from '../utils/notify.util';

const AUTH_COOKIE_NAME = 'crm_auth';
const USER_COOKIE_NAME = 'crm_user';
const ID_TOKEN_COOKIE_NAME = 'crm_token';

@Injectable({
  providedIn: 'root'
})
export class FireAuthDao {
  public auth: Auth;
  public authSate$ = new BehaviorSubject<boolean>(false);
  public currentUser$: Observable<User>;
  public loggedInUser$: Observable<AdminUser>;
  public readonly userPermissions$: Observable<UserPermission[]>;

  public currentAgent$ = new BehaviorSubject<AdminUser>(undefined);

  constructor(
    public fs: Firestore,
    public router: Router,
    public ngZone: NgZone,
    public userService: AdminUserService,
    private cookieService: CookieService,
    private userPermissionService: UserPermissionService
  ) {
    this.auth = getAuth(this.fs.app);
    this.authSate$.next(this.cookieService.check(ID_TOKEN_COOKIE_NAME));

    this.currentUser$ = fromEventPattern(
      (handler) => this.auth.onAuthStateChanged(handler),
      (_handler, unsubscribe) => {
        console.log('auth state changed!')
        unsubscribe();
      }
    );

    this.loggedInUser$ = this.currentUser$.pipe(
      mergeMap((user: User) => {
        const qp: QueryParam[] = [];

        if (user) {
          qp.push(new QueryParam('email', WhereFilterOperandKeys.equal, user.email));
        }
        return this.userService.getAllByValue('email', user.email);
      }),
      // Live-diagnosed via this session's e2e work: a hard page load that
      // lands directly on a route with several components' own streamAll()
      // calls firing in the same tick (e.g. Products' 5 reference-data
      // streams) can catch this getAllByValue() in the exact same
      // WebChannel handshake race documented on retryDelay() in
      // firebase.dao.ts - the SDK mislabels it 'permission-denied', it is
      // not a real rules rejection. Unlike streamAll()/streamByValue(),
      // this one-time read had no retry at all until now, so a single
      // unlucky tick permanently broke role-based nav/tab rendering for the
      // rest of the page's life (shareReplay(1) never retries an errored
      // source). Placed before map() so only the Firestore fetch itself
      // retries - map()'s own "No Record Found" branch is a real,
      // deterministic outcome (and already calls logOut() as a side
      // effect), not a transient race, and shouldn't be retried.
      retry({ count: 4, delay: retryDelay }),
      map((users) => {
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
      shareReplay(1)
    );

    this.userPermissions$ = this.loggedInUser$.pipe(
      mergeMap((agent) => {
        return this.userPermissionService.getAllByValue('owner', agent.id);
      })
    );
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

  public authLogin(provider: any): Promise<UserCredential> {
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
    const that = this;

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
