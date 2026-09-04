import { Injectable, inject, DOCUMENT } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

// Tells a running tab that it is now out of date.
//
// WHY THIS EXISTS. Firebase Hosting replaces the app's hashed chunks on every
// deploy. A tab opened BEFORE a deploy keeps the index.html it loaded with, so
// the moment it lazy-loads a route the chunk filename no longer exists and the
// request 404s. Angular's router never resolves, and the UI simply hangs -
// no error, no message, nothing in the interface to explain it.
//
// That is not hypothetical: on 2026-09-04 an admin pressed Send on a
// 5,607-recipient campaign, the button spun forever, and the only clue was a
// bare "404" in the browser console. The send had actually SUCCEEDED - the
// spinner was a stale chunk. A hard refresh fixed it instantly, once somebody
// knew that was the answer.
//
// The `Cache-Control: no-cache` rule on index.html (firebase.json) does not
// help here. It governs the NEXT page load; it can do nothing for a tab that
// is already running.
//
// NOT A DUPLICATE of AppComponent's recoverFromStaleChunk(), and the two are
// worth telling apart. That one is REACTIVE and narrow: it catches a router
// NavigationError from a failed lazy module and hard-reloads once, after the
// navigation has already broken. It cannot help a stale chunk that fails
// anywhere other than a route change - which is precisely what happened on
// 2026-09-04, where the failure was inside a button handler and no navigation
// was involved, so nothing caught it. This service is PROACTIVE: it tells you
// the tab is stale before you press anything, and leaves reloading to you
// rather than yanking the page away mid-task.
//
// HOW IT DETECTS. The main bundle's filename carries the build hash
// (`main-A1B2C3.js`), so comparing the one this tab booted with against the one
// the server is serving now is a complete and cheap answer - no build step, no
// version file to remember to bump, nothing to keep in sync. Under `ng serve`
// the file is plain `main.js` and never changes, so local development never
// sees a prompt.

/** How often a running tab asks whether it has been superseded. */
export const VERSION_POLL_MS = 5 * 60 * 1000;

/**
 * The script srcs referenced by a chunk of HTML text.
 * @param html Raw HTML.
 * @returns Every script src, in document order.
 */
export function scriptSrcsFromHtml(html: string): string[] {
  return [...(html ?? '').matchAll(/<script[^>]+src="([^"]+)"/gi)].map((m) => m[1]);
}

/**
 * The build-identifying chunk filename out of a list of script srcs.
 *
 * The main bundle is the one that changes whenever application code changes;
 * runtime and polyfills can stay byte-identical across a deploy, so keying on
 * either of those would miss real updates.
 * @param srcs Script srcs, absolute or relative.
 * @returns The main chunk's filename, or null when it cannot be identified.
 */
export function pickBuildChunk(srcs: string[]): string | null {
  for (const src of srcs) {
    const name = (src.split('?')[0].split('/').pop() ?? '');
    if (/^main[.-]/.test(name) && name.endsWith('.js')) {
      return name;
    }
  }
  return null;
}

@Injectable({ providedIn: 'root' })
export class AppVersionService {
  private readonly document = inject(DOCUMENT);

  private readonly available$ = new BehaviorSubject<boolean>(false);
  /** Emits true, once, when the server is serving a newer build. */
  readonly newVersionAvailable$: Observable<boolean> = this.available$.asObservable();

  /** The chunk this tab booted with. Null when it cannot be determined. */
  private booted: string | null = null;
  private handle: ReturnType<typeof setInterval> | null = null;

  /**
   * Begins polling. Safe to call more than once; the second call is a no-op.
   * @param intervalMs How often to check.
   */
  start(intervalMs: number = VERSION_POLL_MS): void {
    if (this.handle) {
      return;
    }
    this.booted = pickBuildChunk(this.currentScriptSrcs());
    // No fingerprint means no reliable comparison, and a version prompt that
    // might be wrong is worse than none - it teaches people to dismiss it.
    if (!this.booted) {
      return;
    }
    this.handle = setInterval(() => void this.check(), intervalMs);
  }

  stop(): void {
    if (this.handle) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }

  /**
   * One comparison against what the server is serving now.
   *
   * Network failures are swallowed: a flaky check must never nag, and the next
   * tick will try again. Once a new build IS found the polling stops - the
   * answer cannot change back, and the prompt is already showing.
   * @returns Whether a newer build was found.
   */
  async check(): Promise<boolean> {
    if (!this.booted || this.available$.value) {
      return this.available$.value;
    }
    try {
      const res = await fetch(`index.html?_=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) {
        return false;
      }
      const latest = pickBuildChunk(scriptSrcsFromHtml(await res.text()));
      if (latest && latest !== this.booted) {
        this.available$.next(true);
        this.stop();
        return true;
      }
    } catch {
      // Offline, or the request was blocked. Try again next tick.
    }
    return false;
  }

  /** Overridable seam for tests; reads the live document otherwise. */
  protected currentScriptSrcs(): string[] {
    return Array.from(this.document.querySelectorAll('script[src]'))
      .map((el) => el.getAttribute('src') ?? '')
      .filter(Boolean);
  }
}
