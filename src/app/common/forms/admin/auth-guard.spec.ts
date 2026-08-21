import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router } from '@angular/router';
import { Observable, firstValueFrom, isObservable, of } from 'rxjs';
import { AdminAuthService, authGuard } from './admin-auth.service';

// SECURITY spec. authGuard is the access-control boundary for every admin
// route, and its own header comment states the rule these tests pin: the
// decision MUST come from the Firebase Auth SDK's session (a live
// getIdTokenResult() whose expiry is checked), NEVER from the unsigned
// "impact-disciples-user" cookie, which is forgeable from devtools.
//
// So the stubs below deliberately expose ONLY dao.currentUser$ and the
// token - there is no cookie/profile anywhere in this TestBed. If someone
// ever reintroduces a cookie-based shortcut, these tests keep passing while
// the "denies a user whose token has expired" case fails, which is the
// signal that matters.

const HOUR = 60 * 60 * 1000;

/** A Firebase user stub whose token expires at the given time. */
function userWithToken(expiresAt: number, opts: { throws?: boolean } = {}) {
  return {
    getIdTokenResult: () =>
      opts.throws ?
        Promise.reject(new Error('network / revoked session')) :
        Promise.resolve({ expirationTime: new Date(expiresAt).toISOString() })
  };
}

function routeTo(path: string): ActivatedRouteSnapshot {
  return { routeConfig: { path } } as ActivatedRouteSnapshot;
}

describe('authGuard', () => {
  let navigations: unknown[][];
  let authService: { dao: { currentUser$: Observable<unknown> }; lastAuthenticatedPath: string };

  function configure(currentUser: unknown): void {
    // Reset first so a single test can reconfigure with a different
    // signed-in state (TestBed refuses a second configure once instantiated).
    TestBed.resetTestingModule();
    navigations = [];
    authService = {
      dao: { currentUser$: of(currentUser) },
      lastAuthenticatedPath: 'untouched'
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AdminAuthService, useValue: authService },
        { provide: Router, useValue: { navigate: (commands: unknown[]) => { navigations.push(commands); return Promise.resolve(true); } } }
      ]
    });
  }

  /** Runs the functional guard in an injection context and resolves its
   *  boolean result (the guard returns an Observable<boolean>). */
  async function runGuard(route: ActivatedRouteSnapshot): Promise<boolean> {
    const result = TestBed.runInInjectionContext(() => authGuard(route, {} as never));
    return isObservable(result) ? firstValueFrom(result as Observable<boolean>) : (result as boolean);
  }

  it('allows a protected route when the session token is still valid', async () => {
    configure(userWithToken(Date.now() + HOUR));

    await expectAsync(runGuard(routeTo('dashboard'))).toBeResolvedTo(true);
    expect(navigations).toEqual([]);
    expect(authService.lastAuthenticatedPath).toBe('dashboard');
  });

  it('denies a protected route when there is no Firebase user at all', async () => {
    configure(null);

    await expectAsync(runGuard(routeTo('dashboard'))).toBeResolvedTo(false);
    expect(navigations).toEqual([['/login']]);
  });

  it('denies a protected route when the token has EXPIRED, even though a user object exists', async () => {
    // The forged-cookie case: an object that looks signed-in is not enough -
    // the live token's expiry is what decides.
    configure(userWithToken(Date.now() - HOUR));

    await expectAsync(runGuard(routeTo('dashboard'))).toBeResolvedTo(false);
    expect(navigations).toEqual([['/login']]);
    expect(authService.lastAuthenticatedPath).toBe('untouched');
  });

  it('denies when the token check itself fails (revoked session / offline)', async () => {
    configure(userWithToken(Date.now() + HOUR, { throws: true }));

    await expectAsync(runGuard(routeTo('dashboard'))).toBeResolvedTo(false);
    expect(navigations).toEqual([['/login']]);
  });

  it('lets a signed-out visitor reach the login and reset-password forms', async () => {
    configure(null);
    await expectAsync(runGuard(routeTo('login'))).toBeResolvedTo(true);

    configure(null);
    await expectAsync(runGuard(routeTo('reset-password'))).toBeResolvedTo(true);
    expect(navigations).toEqual([]);
  });

  it('bounces an already-signed-in user away from the login form', async () => {
    configure(userWithToken(Date.now() + HOUR));

    await expectAsync(runGuard(routeTo('login'))).toBeResolvedTo(false);
    expect(navigations).toEqual([['/']]);
    expect(authService.lastAuthenticatedPath).toBe('/');
  });

  it('still shows the login form to a user whose token has expired', async () => {
    configure(userWithToken(Date.now() - HOUR));

    await expectAsync(runGuard(routeTo('login'))).toBeResolvedTo(true);
    expect(navigations).toEqual([]);
  });

  it('remembers the last authenticated path for a signed-in user', async () => {
    configure(userWithToken(Date.now() + HOUR));

    await runGuard(routeTo('contacts-manager'));
    expect(authService.lastAuthenticatedPath).toBe('contacts-manager');
  });

  it('treats a route with no configured path as the default path', async () => {
    configure(userWithToken(Date.now() + HOUR));

    // The fallback path is '/', which is NOT one of the auth forms, so a
    // signed-in user is simply allowed through and '/' is remembered.
    await expectAsync(runGuard({ routeConfig: null } as ActivatedRouteSnapshot)).toBeResolvedTo(true);
    expect(navigations).toEqual([]);
    expect(authService.lastAuthenticatedPath).toBe('/');
  });
});
