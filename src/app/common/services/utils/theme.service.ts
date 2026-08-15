import { Injectable, effect, signal } from '@angular/core';
import { AdminAuthService } from '../../forms/admin/admin-auth.service';
import { AdminUserService } from '../data/admin-user.service';

const COLOR_THEME_KEY = 'colorTheme';

export const DEFAULT_COLOR_THEME = 'slate-elevate';

// Ids must match the `.theme-{id}` classes emitted by
// src/styles/_theme-variants.scss - shown in the Settings page's picker as
// swatches + label, never as raw ids. All 10 are navy-ground variants from
// the approved "Navy Directions" redesign; slate-elevate is the default and
// is also what :root carries before any class is applied.
export const COLOR_THEMES: readonly { id: string; label: string }[] = [
  { id: 'slate-elevate', label: 'Slate Elevate' },
  { id: 'midnight-paper', label: 'Midnight Paper' },
  { id: 'glassline', label: 'Glassline' },
  { id: 'harbor-split', label: 'Harbor Split' },
  { id: 'abyss-glow', label: 'Abyss Glow' },
  { id: 'indigo-soft', label: 'Indigo Soft' },
  { id: 'steel-rail', label: 'Steel Rail' },
  { id: 'horizon', label: 'Horizon' },
  { id: 'ensign', label: 'Ensign' },
  { id: 'quarterdeck', label: 'Quarterdeck' }
];

// Legacy ids (pre-navy 'default'/'forest'/'berry'/'sunset', or anything else
// unrecognized, e.g. from a Firestore profile written by an older build) fold
// into the default rather than leaving a dead theme-* class on <html>. No
// proactive Firestore write-back - the next setColorTheme() persists the
// normalized value naturally.
export function normalizeThemeId(id: string | null | undefined): string {
  return COLOR_THEMES.some((t) => t.id === id) ? (id as string) : DEFAULT_COLOR_THEME;
}

// Module-scope, not per-instance - see the comment on the loggedInUser$
// subscription below for why this has to survive across every ThemeService
// instance for the rest of this page load, not just one.
let remoteSyncLocked = false;

// App-wide color theme, persisted per-admin (see AdminUser.colorTheme) so it
// follows them across devices. The old independent dark-mode toggle is gone -
// the navy redesign's 10 variants each fix their own light/dark character
// (AdminUser.darkMode still exists on the model for old docs to round-trip,
// it's just never read or written any more).
//
// localStorage is the fast, pre-auth bootstrap value (there's no Firestore
// access before sign-in, and reading it synchronously avoids a flash of
// the wrong theme while the profile loads); once the signed-in admin's
// profile loads, its fields become the source of truth and follow them
// across devices. setColorTheme writes both.
//
// Instantiated at boot by AppComponent's injection (nothing else needs to
// happen) - without that, a root-provided service is only constructed on
// first injection, which used to be the Settings screen, so a saved theme
// wasn't applied until the user happened to open Settings.
@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  readonly colorTheme = signal<string>(normalizeThemeId(localStorage.getItem(COLOR_THEME_KEY)));

  // Tracks whichever theme-{id} class is currently applied to <html>, so
  // the next change can remove exactly that one rather than guessing.
  private appliedThemeClass: string | undefined;

  constructor(private authService: AdminAuthService, private userService: AdminUserService) {
    effect(() => {
      const theme = this.colorTheme();

      // Always apply the class - even for the default. :root makes the
      // default correct with no class at all, but an explicit class keeps
      // the Settings swatches honest (a swatch wrapped in an empty class
      // would inherit whatever theme is currently applied to <html>).
      if (this.appliedThemeClass) {
        document.documentElement.classList.remove(this.appliedThemeClass);
      }
      this.appliedThemeClass = `theme-${theme}`;
      document.documentElement.classList.add(this.appliedThemeClass);

      localStorage.setItem(COLOR_THEME_KEY, theme);
    });

    // Once the signed-in admin's own saved preference loads, it overrides
    // the localStorage bootstrap value above and follows them to any device.
    //
    // Live-diagnosed bug this guarded against: FireAuthDao.loggedInUser$ is
    // a ONE-TIME Firestore read (getAllByValue, not a live onSnapshot
    // listener) wrapped in shareReplay(1) - once it has emitted for this
    // page load, that snapshot is cached FOREVER and never refetches, even
    // though setColorTheme's own persist() call keeps writing real updates
    // to the same Firestore doc. Without this guard, calling setColorTheme()
    // and then having this subscription's (possibly still in-flight, or
    // simply late-scheduled) callback fire afterward would silently
    // overwrite the just-applied local change with that stale cached
    // snapshot - which is exactly what "I switched themes and saw no
    // difference" turned out to be: the theme WAS applied for a moment,
    // then immediately reverted. remoteSyncLocked is set the instant the
    // admin makes any local change, for the rest of this page load (a real
    // page reload resets it, which is exactly when re-checking the remote
    // value for cross-device sync is wanted again).
    this.authService.dao.loggedInUser$.subscribe((user) => {
      if (remoteSyncLocked) {
        return;
      }
      if (user?.colorTheme) {
        this.colorTheme.set(normalizeThemeId(user.colorTheme));
      }
    });
  }

  setColorTheme(value: string): void {
    remoteSyncLocked = true;
    this.colorTheme.set(normalizeThemeId(value));
    this.persist({ colorTheme: normalizeThemeId(value) });
  }

  private persist(changes: { colorTheme?: string }): void {
    // FirebaseDAO.update() is a full setDoc (no merge) - the write has to
    // carry the whole record, not just the changed field, same as every
    // other update() call site in this codebase.
    const user = this.authService.dao.currentAgent$.value;
    if (user?.id) {
      this.userService.update(user.id, { ...user, ...changes }).catch((err) => {
        console.error('ThemeService: failed to save theme preference:', err);
      });
    }
  }
}
