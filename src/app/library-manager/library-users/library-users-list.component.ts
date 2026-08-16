import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule, MatCheckboxChange } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { countryFlagEmoji } from '@impact-common/util/country-flag.util';
import { LibraryUser } from 'src/app/common/models/domain/library/library-user.model';
import { LibraryUserService } from 'src/app/common/services/data/library/library-user.service';
import {
  LibraryRowSelection,
  createLibraryRowSelection,
} from 'src/app/common/services/data/library/library-row-selection.util';
import {
  LibrarySendMessageDialogComponent,
  LibrarySendMessageDialogResult,
} from '../dialogs/library-send-message-dialog.component';

/**
 * Ported from impact-discipleship-library-manager-new's
 * library-users-list.component.ts. Admin-only roster of reader-app library
 * users (`libraryUsers` - a different population from this app's own
 * `admin_users` staff): who they are, when/where they last signed in,
 * international flag, license counts, revoked status. Rows open the full
 * detail/edit screen (`/library-manager/library-users/:email`); the
 * checkbox column feeds "Message selected"/"Message all". Adapted to this
 * app's tab-shell convention (no "Back to library"/Help header).
 */
@Component({
  selector: 'app-library-users-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
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
  templateUrl: './library-users-list.component.html',
  styleUrl: './library-users-list.component.scss',
})
export class LibraryUsersListComponent {
  readonly displayedColumns = [
    'select',
    'name',
    'email',
    'lastLogin',
    'location',
    'licenses',
    'status',
  ];
  users: LibraryUser[] = [];
  loading = true;
  filter = '';

  /** Selected doc ids (lowercased emails). */
  private readonly selection: LibraryRowSelection = createLibraryRowSelection();
  readonly selected = this.selection.selected;

  trackByLibraryUserId(_index: number, user: LibraryUser): string {
    return user.id;
  }

  get filteredUsers(): LibraryUser[] {
    const term = this.filter.trim().toLowerCase();
    if (!term) {
      return this.users;
    }
    return this.users.filter((user) =>
      [user.email, user.firstName, user.lastName, user.location?.country, user.location?.city]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term)),
    );
  }

  get allVisibleSelected(): boolean {
    return this.selection.allVisibleSelected(this.filteredUsers.map((user) => user.id));
  }

  get selectedCount(): number {
    return this.selected().size;
  }

  constructor(
    private libraryUserService: LibraryUserService,
    private dialog: MatDialog,
    private snackbar: SnackbarService,
    private router: Router,
  ) {
    this.libraryUserService.getLibraryUsers().subscribe((users) => {
      this.users = users;
      this.loading = false;
      this.selection.pruneToLiveIds(users.map((user) => user.id));
    });
  }

  userName(user: LibraryUser): string {
    return [user.firstName, user.lastName].filter(Boolean).join(' ');
  }

  locationFlag(user: LibraryUser): string {
    return countryFlagEmoji(user.location?.countryCode);
  }

  locationLabel(user: LibraryUser): string {
    const location = user.location;
    return [location?.city, location?.region, location?.country].filter(Boolean).join(', ');
  }

  /** 'all' is the legacy staff-bypass value; an international user's
   *  effective access is every book regardless of the stored array. */
  licenseLabel(user: LibraryUser): string {
    if (user.internationalUser || user.licensedBookIds === 'all') {
      return 'All books';
    }
    const count = Array.isArray(user.licensedBookIds) ? user.licensedBookIds.length : 0;
    return count === 1 ? '1 book' : `${count} books`;
  }

  isSelected(id: string): boolean {
    return this.selection.isSelected(id);
  }

  toggleRow(id: string, event: MatCheckboxChange): void {
    this.selection.toggle(id, event.checked);
  }

  toggleSelectAllVisible(): void {
    this.selection.toggleAllVisible(this.filteredUsers.map((user) => user.id));
  }

  openDetail(user: LibraryUser): void {
    void this.router.navigate(['/library-manager/library-users', user.id]);
  }

  async messageSelected(): Promise<void> {
    const emails = [...this.selected()];
    if (emails.length === 0) {
      return;
    }
    await this.openSendMessage(
      emails,
      `${emails.length} selected user${emails.length === 1 ? '' : 's'}`,
    );
  }

  async messageAll(): Promise<void> {
    await this.openSendMessage('all', 'All library users (revoked users excluded)');
  }

  private async openSendMessage(
    recipients: string[] | 'all',
    recipientLabel: string,
  ): Promise<void> {
    const ref = this.dialog.open(LibrarySendMessageDialogComponent, {
      width: '520px',
      data: { recipients, recipientLabel },
    });
    const result: LibrarySendMessageDialogResult | undefined = await firstValueFrom(
      ref.afterClosed(),
    );
    if (result) {
      this.snackbar.success(
        `Sent to ${result.recipientCount} user${result.recipientCount === 1 ? '' : 's'} ` +
          `(${result.pushSuccessCount} device notification${result.pushSuccessCount === 1 ? '' : 's'} delivered; ` +
          'everyone also gets it in their reader-app inbox).',
      );
      this.selection.clear();
    }
  }
}
