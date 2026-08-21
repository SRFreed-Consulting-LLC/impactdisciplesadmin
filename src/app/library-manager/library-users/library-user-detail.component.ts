import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { countryFlagEmoji } from '@impact-common/util/country-flag.util';
import {
  LibraryUser,
  LibraryUserBookLicense,
} from 'src/app/common/models/domain/library/library-user.model';
import { LibraryUserService } from 'src/app/common/services/data/library/library-user.service';
import { LibraryBookService } from 'src/app/common/services/data/library/library-book.service';
import { LibraryPermissionService } from 'src/app/common/services/data/library/library-permission.service';
import { LibraryErrorLogService } from 'src/app/common/services/data/library/library-error-log.service';
import {
  LibraryGrantLicensesDialogComponent,
  LibraryGrantLicensesDialogResult,
} from '../dialogs/library-grant-licenses-dialog.component';
import {
  LibrarySendMessageDialogComponent,
  LibrarySendMessageDialogResult,
} from '../dialogs/library-send-message-dialog.component';

/**
 * Ported from impact-discipleship-library-manager-new's
 * library-user-detail/library-user-detail.component.ts. Full-page
 * admin view/edit of one reader-app library user. Editable fields
 * (firstName/lastName/phone/internationalUser) go through the
 * updateLibraryUser Cloud Function - firestore.rules scopes libraryUsers
 * writes to the owner's own email, so nothing here writes Firestore
 * directly. Everything else the reader app owns (login analytics,
 * personal preferences) is shown read-only. Also hosts the
 * revoke/restore-access action, the license grant/removal table, and a
 * single-recipient message shortcut. Route:
 * /library-manager/library-users/:email.
 *
 * Ported faithfully, including one quirk from the source: the write
 * actions below are gated by isFullAccess() (Admin/Root - see
 * LibraryPermissionService, this app's equivalent of the source's own
 * PermissionService.isAdmin) inside each method, not by hiding/disabling
 * the buttons in the template - an Editor can still see this screen (same
 * as every other Library tab) and click Save/Revoke/Grant, they just
 * silently no-op. Matched rather than "fixed" since that's the source
 * app's actual real behavior, same reasoning as Groups' own doc comment.
 */
@Component({
  selector: 'app-library-user-detail',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './library-user-detail.component.html',
  styleUrl: './library-user-detail.component.scss',
})
export class LibraryUserDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly libraryUserService = inject(LibraryUserService);
  private readonly bookService = inject(LibraryBookService);
  private readonly permissionService = inject(LibraryPermissionService);
  private readonly fb = inject(FormBuilder);
  private readonly snackbar = inject(SnackbarService);
  private readonly confirmService = inject(ConfirmService);
  private readonly errorLog = inject(LibraryErrorLogService);
  private readonly dialog = inject(MatDialog);

  readonly isAdmin = (): boolean => this.permissionService.isFullAccess();
  readonly email = decodeURIComponent(this.route.snapshot.paramMap.get('email') ?? '')
    .trim()
    .toLowerCase();

  readonly profile = signal<LibraryUser | undefined>(undefined);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly togglingAccess = signal(false);
  private readonly bookTitles = signal<Map<string, string>>(new Map());

  readonly licenseColumns = ['book', 'source', 'date', 'actions'];

  readonly displayName = computed(() => {
    const user = this.profile();
    return user
      ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || user.id
      : this.email;
  });

  trackByLicenseBookId(_index: number, license: LibraryUserBookLicense): string {
    return license.bookId;
  }

  readonly licenses = computed<LibraryUserBookLicense[]>(() => {
    const list = this.profile()?.bookLicenses;
    return Array.isArray(list)
      ? [...list].sort((a, b) => this.bookTitle(a.bookId).localeCompare(this.bookTitle(b.bookId)))
      : [];
  });

  /** The international flag makes the per-book list moot - effective access
   *  is every book. (Staff access comes from the role claim, not this doc.) */
  readonly hasAllBooks = computed(() => {
    const user = this.profile();
    return !!user && user.internationalUser === true;
  });

  readonly form = this.fb.nonNullable.group({
    firstName: [''],
    lastName: [''],
    phone: [''],
    internationalUser: [false],
  });

  constructor() {
    this.libraryUserService.getLibraryUser(this.email).subscribe((user) => {
      this.profile.set(user);
      this.loading.set(false);
      // Don't clobber unsaved edits on live re-emits triggered by our own
      // saves - only patch pristine forms.
      if (user && !this.form.dirty) {
        this.form.patchValue(
          {
            firstName: user.firstName ?? '',
            lastName: user.lastName ?? '',
            phone: user.phone ?? '',
            internationalUser: user.internationalUser === true,
          },
          { emitEvent: false },
        );
      }
    });

    this.bookService
      .getAll()
      .then((books) => this.bookTitles.set(new Map(books.map((book) => [book.id!, book.title]))));
  }

  bookTitle(bookId: string): string {
    return this.bookTitles().get(bookId) ?? bookId;
  }

  sourceLabel(license: LibraryUserBookLicense): string {
    switch (license.source) {
      case 'admin-grant':
        return 'Admin grant';
      case 'group-license':
        return 'Impact Group license';
      default:
        return 'Purchase';
    }
  }

  locationLabel(user: LibraryUser): string {
    const location = user.location;
    const label = [location?.city, location?.region, location?.country].filter(Boolean).join(', ');
    return label ? `${countryFlagEmoji(location?.countryCode)} ${label}`.trim() : '';
  }

  async saveProfile(): Promise<void> {
    if (this.form.invalid || !this.isAdmin() || this.saving()) {
      return;
    }
    this.saving.set(true);
    try {
      await this.libraryUserService.updateLibraryUser(
        this.email,
        this.form.getRawValue(),
        this.displayName(),
      );
      this.form.markAsPristine();
      this.snackbar.success('Profile updated.');
    } catch (error) {
      this.errorLog.logError('LibraryUserDetailComponent.saveProfile', error);
      this.snackbar.error('Could not save profile changes. Please try again.');
    } finally {
      this.saving.set(false);
    }
  }

  async toggleRevoked(): Promise<void> {
    const user = this.profile();
    if (!user || !this.isAdmin() || this.togglingAccess()) {
      return;
    }
    const revoking = user.revoked !== true;
    const confirmed = await this.confirmService.confirm(
      revoking
        ? `Revoke ${this.displayName()}'s access? They will no longer be able to sign in to the ` +
            'reader app and lose access to all book content. Their account, licenses, and history ' +
            'are kept, and access can be restored here at any time.'
        : `Restore ${this.displayName()}'s access? They will be able to sign in and use their ` +
            'licenses again.',
      revoking ? 'Revoke access' : 'Restore access',
    );
    if (!confirmed) {
      return;
    }
    this.togglingAccess.set(true);
    try {
      const authAccountFound = await this.libraryUserService.setRevoked(
        this.email,
        revoking,
        this.displayName(),
      );
      const suffix = authAccountFound
        ? ''
        : ' (No sign-in account exists for this email - only the library record was flagged.)';
      this.snackbar.success(`${revoking ? 'Access revoked.' : 'Access restored.'}${suffix}`);
    } catch (error) {
      this.errorLog.logError('LibraryUserDetailComponent.toggleRevoked', error);
      this.snackbar.error(`Could not ${revoking ? 'revoke' : 'restore'} access. Please try again.`);
    } finally {
      this.togglingAccess.set(false);
    }
  }

  async openGrantLicenses(): Promise<void> {
    const user = this.profile();
    if (!user || !this.isAdmin()) {
      return;
    }
    const ref = this.dialog.open(LibraryGrantLicensesDialogComponent, {
      width: '480px',
      data: { user },
    });
    const result: LibraryGrantLicensesDialogResult | undefined = await firstValueFrom(
      ref.afterClosed(),
    );
    if (result && result.granted.length > 0) {
      this.snackbar.success(
        `Granted ${result.granted.length} license${result.granted.length === 1 ? '' : 's'}: ${result.grantedTitles.join(', ')}`,
      );
    }
  }

  /** Pre-prod #6: manual removal of a STORE-PURCHASED license (no refund
   *  involved - refunds live on the Purchases screen and strip their own
   *  licenses when asked). */
  async removeStoreLicense(license: LibraryUserBookLicense): Promise<void> {
    if (!this.isAdmin() || license.source !== 'store-purchase') {
      return;
    }
    const title = this.bookTitle(license.bookId);
    const confirmed = await this.confirmService.confirm(
      `Remove the store-purchased license for "${title}" from ${this.displayName()}? ` +
        'This does NOT refund the purchase - refunds are issued from the Purchases screen.',
      'Remove purchased license',
    );
    if (!confirmed) {
      return;
    }
    try {
      await this.libraryUserService.revokeStoreLicense(
        this.email,
        license.bookId,
        this.displayName(),
        title,
      );
      this.snackbar.success(`License for "${title}" removed.`);
    } catch (error) {
      this.errorLog.logError('LibraryUserDetailComponent.removeStoreLicense', error);
      this.snackbar.error('Could not remove that license. Please try again.');
    }
  }

  async removeLicense(license: LibraryUserBookLicense): Promise<void> {
    if (!this.isAdmin() || license.source !== 'admin-grant') {
      return;
    }
    const title = this.bookTitle(license.bookId);
    const confirmed = await this.confirmService.confirm(
      `Remove the admin-granted license for "${title}" from ${this.displayName()}?`,
      'Remove granted license',
    );
    if (!confirmed) {
      return;
    }
    try {
      await this.libraryUserService.revokeGrantedLicense(
        this.email,
        license.bookId,
        this.displayName(),
        title,
      );
      this.snackbar.success(`License for "${title}" removed.`);
    } catch (error) {
      this.errorLog.logError('LibraryUserDetailComponent.removeLicense', error);
      this.snackbar.error('Could not remove that license. Please try again.');
    }
  }

  async openSendMessage(): Promise<void> {
    const ref = this.dialog.open(LibrarySendMessageDialogComponent, {
      width: '520px',
      data: { recipients: [this.email], recipientLabel: this.displayName() },
    });
    const result: LibrarySendMessageDialogResult | undefined = await firstValueFrom(
      ref.afterClosed(),
    );
    if (result) {
      this.snackbar.success(
        `Message sent (${result.pushSuccessCount > 0 ? 'device notification delivered' : 'saved to inbox; no device reached'}).`,
      );
    }
  }
}
