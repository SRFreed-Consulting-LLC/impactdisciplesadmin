import { Injectable, effect, signal } from '@angular/core';
import { AdminAuthService } from '../../forms/admin/admin-auth.service';
import { AdminUserService } from '../data/admin-user.service';

const DARK_MODE_KEY = 'darkMode';
const COLOR_THEME_KEY = 'colorTheme';

export const DEFAULT_COLOR_THEME = 'default';

// Ids must match the `.theme-{id}` classes in
// src/assets/theme/scss/_theme-accents.scss - shown in the Settings page's
// accent picker as swatches + label, never as raw ids. 'default' is this
// app's own base theme (_material-theme.scss) and needs no extra class.
export const COLOR_THEMES: readonly { id: string; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'forest', label: 'Forest' },
  { id: 'berry', label: 'Berry' },
  { id: 'sunset', label: 'Sunset' }
];

// App-wide dark mode + accent color toggle, persisted per-admin (see
// AdminUser.darkMode/colorTheme) so it follows them across devices. A
// deliberately simplified take on impact-discipleship-library-manager-
// new's BaseThemeService (see that file's own comment) - one concrete
// service instead of an abstract base + per-app subclass (only one app to
// support here), one shared color theme instead of independent light/dark
// catalogs, no per-theme structural reskins.
//
// localStorage is the fast, pre-auth bootstrap value (there's no Firestore
// access before sign-in, and reading it synchronously avoids a flash of
// the wrong theme while the profile loads); once the signed-in admin's
// profile loads, its fields become the source of truth and follow them
// across devices. setDarkMode/setColorTheme write both.
@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  readonly darkMode = signal<boolean>(this.readInitialDarkMode());
  readonly colorTheme = signal<string>(localStorage.getItem(COLOR_THEME_KEY) ?? DEFAULT_COLOR_THEME);

  // Tracks whichever theme-{id} class is currently applied to <html>, so
  // the next change can remove exactly that one rather than guessing.
  private appliedThemeClass: string | undefined;

  constructor(private authService: AdminAuthService, private userService: AdminUserService) {
    effect(() => {
      document.documentElement.classList.toggle('dark-theme', this.darkMode());
      localStorage.setItem(DARK_MODE_KEY, String(this.darkMode()));
    });

    effect(() => {
      const theme = this.colorTheme();

      if (this.appliedThemeClass) {
        document.documentElement.classList.remove(this.appliedThemeClass);
        this.appliedThemeClass = undefined;
      }
      if (theme !== DEFAULT_COLOR_THEME) {
        this.appliedThemeClass = `theme-${theme}`;
        document.documentElement.classList.add(this.appliedThemeClass);
      }

      localStorage.setItem(COLOR_THEME_KEY, theme);
    });

    // Once the signed-in admin's own saved preferences load, they override
    // the localStorage bootstrap value above and follow them to any device.
    this.authService.dao.loggedInUser$.subscribe((user) => {
      if (user?.darkMode !== undefined) {
        this.darkMode.set(user.darkMode);
      }
      if (user?.colorTheme) {
        this.colorTheme.set(user.colorTheme);
      }
    });
  }

  setDarkMode(value: boolean): void {
    this.darkMode.set(value);
    this.persist({ darkMode: value });
  }

  setColorTheme(value: string): void {
    this.colorTheme.set(value);
    this.persist({ colorTheme: value });
  }

  private persist(changes: { darkMode?: boolean; colorTheme?: string }): void {
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

  private readInitialDarkMode(): boolean {
    const stored = localStorage.getItem(DARK_MODE_KEY);
    if (stored !== null) {
      return stored === 'true';
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }
}
