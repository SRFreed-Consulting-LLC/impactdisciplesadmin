import { EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LoggerService } from 'src/app/common/services/data/logger.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
// Type-only imports - a real import here would drag the dialog's whole
// lazy-loaded chunk into every route's eager bundle.
import type {
  LibraryUnsavedChangesDialogComponent,
  LibraryUnsavedChangesDialogResult,
} from '../../shared/unsaved-changes-dialog/library-unsaved-changes-dialog.component';

export interface LibraryUnsavedChangesEditor {
  hasUnsavedChanges(): boolean;
  save(): Promise<void>;
}

/**
 * Generic CanDeactivate guard for any Form.io-builder-style Library editor
 * page that exposes `hasUnsavedChanges()`/`save()` - offers to save before
 * leaving instead of silently discarding changes. Ported from
 * impact-discipleship-library-manager-new's core/guards/unsaved-changes.guard.ts,
 * adapted to log failures via this app's own LoggerService ("log-messages")
 * instead of that app's ErrorLogService - see the consolidation plan's
 * "Decided - logging".
 *
 * `beforeSave`, if given, runs after "Save and Leave" is chosen but before the
 * actual `save()` call - the Lesson editor uses this to implicitly keep a
 * pending subtemplate-merge preview rather than silently dropping it.
 */
export function libraryUnsavedChangesGuard<T extends LibraryUnsavedChangesEditor>(
  itemLabel: string,
  failureMessage: string,
  beforeSave?: (component: T) => void,
): CanDeactivateFn<T> {
  return async (component) => {
    if (!component.hasUnsavedChanges()) {
      return true;
    }

    const injector = inject(EnvironmentInjector);
    const [{ MatDialog }, { MatSnackBar }, { LibraryUnsavedChangesDialogComponent: DialogComponent }] =
      await Promise.all([
        import('@angular/material/dialog'),
        import('@angular/material/snack-bar'),
        import('../../shared/unsaved-changes-dialog/library-unsaved-changes-dialog.component'),
      ]);
    const { dialog, snackBar, logger, authService } = runInInjectionContext(injector, () => ({
      dialog: inject(MatDialog),
      snackBar: inject(MatSnackBar),
      logger: inject(LoggerService),
      authService: inject(AdminAuthService),
    }));

    const ref = dialog.open<
      LibraryUnsavedChangesDialogComponent,
      { itemLabel: string },
      LibraryUnsavedChangesDialogResult
    >(DialogComponent, { width: '480px', data: { itemLabel } });
    const result = await firstValueFrom(ref.afterClosed());

    if (result === 'discard') {
      return true;
    }
    if (result !== 'save') {
      return false;
    }

    try {
      beforeSave?.(component);
      await component.save();
      return true;
    } catch (error) {
      const user = await firstValueFrom(authService.dao.loggedInUser$);
      logger
        .logMessage(
          'LIBRARY',
          user?.email ?? 'unknown',
          `libraryUnsavedChangesGuard.save.${itemLabel} failed: ${error}`,
          [{ error: String(error) }],
        )
        .subscribe();
      // Stay on the page rather than navigating away with the save (and the
      // changes that prompted it) having silently failed.
      snackBar.open(failureMessage, 'Dismiss', { duration: 5000 });
      return false;
    }
  };
}
