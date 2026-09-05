import { Injectable } from '@angular/core';
import { MatSnackBar, MatSnackBarRef, TextOnlySnackBar } from '@angular/material/snack-bar';

/** See SnackbarService.somethingWentWrong(). Exported so a spec can pin it. */
export const SOMETHING_WENT_WRONG = 'Something went wrong. Please try again.';

/**
 * Material replacement for devextreme/ui/notify's notify({message, type}).
 * Only 'success' and 'error' types are actually used anywhere in this app.
 */
@Injectable({ providedIn: 'root' })
export class SnackbarService {
  constructor(private snackBar: MatSnackBar) {}

  success(message: string): void {
    this.snackBar.open(message, 'Dismiss', {
      duration: 4000,
      panelClass: 'app-snackbar-success'
    });
  }

  error(message: string): void {
    this.snackBar.open(message, 'Dismiss', {
      duration: 6000,
      panelClass: 'app-snackbar-error'
    });
  }

  /**
   * The one generic failure message, for a write or upload that did not
   * happen and has nothing more specific to say.
   *
   * It was the literal 'Some Error Occured' - misspelled, and pasted into
   * 36 call sites across 21 files, which is why it stayed misspelled for a
   * month after the first person noticed. A message staff read belongs in
   * one place with one spelling.
   */
  somethingWentWrong(): void {
    this.error(SOMETHING_WENT_WRONG);
  }

  /**
   * A snackbar with NO duration - it stays until the action is pressed.
   *
   * For the one case where dismissing is the wrong outcome: the app telling
   * you it is running stale code. A timed message would vanish while you were
   * reading something else and leave you on a build whose next lazy route
   * 404s, which is a silent hang rather than an error (see AppVersionService).
   * @param message What happened.
   * @param action The button label.
   * @returns A ref whose onAction() fires when the button is pressed.
   */
  persistent(message: string, action: string): MatSnackBarRef<TextOnlySnackBar> {
    return this.snackBar.open(message, action, {
      panelClass: 'app-snackbar-info'
    });
  }
}
