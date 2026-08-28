import { describeLoginFailure } from './login-failure';

// Sweep finding R2. These four messages sit on the highest-traffic path in
// the app and had no test of any kind - they were four copy-pasted
// catchError branches inside a 123-line method, reachable only by standing
// up AdminAuthService and mocking Firebase. As a pure function they need
// none of that.
//
// The assertions below are deliberately about CONTENT, not exact prose:
// pinning every word would make a copy edit look like a regression. What
// must not drift is the identity of who to contact, the presence of the
// errorLogs reference, and the separation between what is logged and what
// is shown.

describe('describeLoginFailure', () => {
  const EMAIL = 'staff@impactdisciples.com';
  const REF = 'errlog-123';

  const codes = [
    'auth/wrong-password',
    'auth/user-not-found',
    'auth/too-many-requests',
    'auth/network-request-failed',
    undefined
  ];

  it('answers for every code, known or not', () => {
    for (const code of codes) {
      const failure = describeLoginFailure(code, EMAIL);
      expect(failure.log).withContext(String(code)).toBeTruthy();
      expect(failure.message(REF)).withContext(String(code)).toBeTruthy();
    }
  });

  it('always carries the errorLogs reference into the visible message', () => {
    // This is the number someone reads out when they phone for help - a
    // message without it leaves both sides with nothing to go on.
    for (const code of codes) {
      expect(describeLoginFailure(code, EMAIL).message(REF))
        .withContext(String(code)).toContain(REF);
    }
  });

  it('never names a company other than the org itself', () => {
    // The wrong-password branch used to say "contact Alliance Group",
    // which has nothing to do with this app. It drifted precisely because
    // it was one of four copies nobody diffed.
    for (const code of codes) {
      expect(describeLoginFailure(code, EMAIL).message(REF))
        .withContext(String(code)).not.toContain('Alliance Group');
    }
  });

  it('tells the user who to contact, consistently', () => {
    for (const code of codes) {
      expect(describeLoginFailure(code, EMAIL).message(REF).toLowerCase())
        .withContext(String(code)).toContain('admin');
    }
  });

  it('names the address only when the address is the problem', () => {
    expect(describeLoginFailure('auth/user-not-found', EMAIL).log)
      .toContain(EMAIL);
    // A network failure is not a bad address. Logging it as one made
    // errorLogs - the ground truth for who cannot sign in - misleading.
    expect(describeLoginFailure('auth/network-request-failed', EMAIL).log)
      .not.toContain(EMAIL);
    expect(describeLoginFailure(undefined, EMAIL).log).not.toContain(EMAIL);
  });

  it('logs the fault and shows the remedy - they are not the same text', () => {
    const failure = describeLoginFailure('auth/wrong-password', EMAIL);
    expect(failure.log).toContain('incorrect password');
    // The remedy names the button the user should press.
    expect(failure.message(REF)).toContain('Forgot Password');
    expect(failure.log).not.toContain('Forgot Password');
  });

  it('distinguishes a locked account from a wrong password', () => {
    const locked = describeLoginFailure('auth/too-many-requests', EMAIL);
    expect(locked.log.toLowerCase()).toContain('too many');
    expect(locked.message(REF).toLowerCase()).toContain('too many failed');
  });

  it('records the unrecognised code so an unknown fault is diagnosable', () => {
    expect(describeLoginFailure('auth/internal-error', EMAIL).log)
      .toContain('auth/internal-error');
    expect(describeLoginFailure(undefined, EMAIL).log).toContain('no code');
  });
});
