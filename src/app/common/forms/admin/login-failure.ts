/**
 * What a failed admin login writes to errorLogs, and what it tells the
 * person at the keyboard.
 *
 * Sweep finding R2. AdminAuthService.logIn() was a 123-line island whose
 * bulk was four copy-pasted catchError branches, identical except for two
 * strings each. Every change meant four edits, and the shapes had already
 * drifted apart in exactly the way that predicts:
 *
 *   - the wrong-password branch told staff to "contact Alliance Group",
 *     a company that has nothing to do with this app. The other three
 *     said "your Admin". Corrected here.
 *   - only that same branch passed `position: 'top'` to notify(), so one
 *     of the four messages appeared somewhere different from its
 *     siblings. Now they all do.
 *   - the catch-all branch LOGGED "The email address (x) is not
 *     recognized." for errors that had nothing to do with the address -
 *     a network failure, an internal error - while showing a generic
 *     message on screen. errorLogs is the ground truth for who is having
 *     trouble signing in, so mislabelling an unknown fault as a bad
 *     address makes that record actively misleading. It now records what
 *     actually happened.
 *
 * The `code` in each user-facing message is the errorLogs document id
 * returned by LoggerService.logMessage - the reference someone reads out
 * when they call for help. That is why the message is a function rather
 * than a constant.
 */

export interface LoginFailure {
  /** Recorded in errorLogs. Describes the FAULT, not the remedy. */
  log: string;
  /** Shown to the person signing in, given the errorLogs reference. */
  message: (reference: string | boolean) => string;
}

const CONTACT = 'If the problem continues, please contact your Admin for ' +
  'assistance with this code: ';

export function describeLoginFailure(
  code: string | undefined,
  email: string
): LoginFailure {
  switch (code) {
    case 'auth/wrong-password':
      return {
        log: 'You have entered an incorrect password for this email address.',
        message: (ref) =>
          'You have entered an incorrect password for this email address. ' +
          'If you have forgotten your password, enter your Email Address ' +
          'and press the "Forgot Password" button. ' + CONTACT + ref
      };

    case 'auth/user-not-found':
      return {
        log: `The email address (${email}) is not recognized.`,
        message: (ref) =>
          `The email address (${email}) is not recognized. Correct the ` +
          'Email Address and Try again. ' + CONTACT + ref
      };

    case 'auth/too-many-requests':
      return {
        log: 'Too many failed attempts. The account is temporarily locked.',
        message: (ref) =>
          'There have been too many failed logins to this account. Please ' +
          'reset your password by going to the login screen, entering your ' +
          'password, and pressing the "Forgot Password" button. ' +
          CONTACT + ref
      };

    default:
      return {
        // Was "The email address (x) is not recognized." - see the header.
        log: `Sign-in failed with an unexpected error (${code ?? 'no code'}).`,
        message: (ref) =>
          'There was an Error accessing your account. Please contact your ' +
          'Admin for Assistance with this code: ' + ref
      };
  }
}
