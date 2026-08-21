import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SelectionModel } from '@angular/cdk/collections';
import { MatDialog } from '@angular/material/dialog';
import { SharedModule } from 'src/app/shared/shared.module';
import { DataGridColumn } from 'src/app/shared/data-grid/data-grid.model';
import { ListHeaderAction } from 'src/app/shared/list-header/list-header.component';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { countryFlagEmoji } from '@impact-common/util/country-flag.util';
import { LibraryUser } from 'src/app/common/models/domain/library/library-user.model';
import { LibraryUserService } from 'src/app/common/services/data/library/library-user.service';
import { PagedCollectionSource } from 'src/app/shared/paged-collection-source';
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
 *
 * Paged (PagedCollectionSource over getLibraryUsersPage, ordered by doc
 * id = email) instead of the whole-collection live listener this started
 * with - same conversion as Products/Customers/Log Messages. Trade-offs,
 * same as those screens: rows don't update live from other sessions, and
 * the column filters + "select all" only cover rows loaded so far
 * (scrolling to the bottom keeps loading more until the roster is fully
 * in). "Message all" is unaffected - the Cloud Function resolves 'all'
 * server-side, never from the loaded rows. The World Map keeps its own
 * whole-collection live feed (it needs every location dot at once).
 */
@Component({
  selector: 'app-library-users-list',
  standalone: true,
  // SharedModule for <app-data-grid> - see lesson-templates-list.
  imports: [CommonModule, SharedModule],
  templateUrl: './library-users-list.component.html',
  styleUrl: './library-users-list.component.scss',
})
export class LibraryUsersListComponent {
  readonly columns: DataGridColumn<LibraryUser>[] = [
    { key: 'name', label: 'Name', value: (u) => this.userName(u) },
    { key: 'email', label: 'Email' },
    { key: 'lastLogin', label: 'Last login', type: 'date', dateFormat: 'MMM d, y' },
    { key: 'location', label: 'Location', value: (u) => this.locationCell(u) },
    { key: 'licenses', label: 'Licenses', value: (u) => this.licenseLabel(u) },
    { key: 'status', label: 'Status', value: (u) => (u.revoked ? 'REVOKED' : 'Active') },
  ];

  readonly headerActions: ListHeaderAction[] = [
    { label: 'Message Selected', icon: 'forward_to_inbox', onClick: () => void this.messageSelected() },
    { label: 'Message All', icon: 'campaign', onClick: () => void this.messageAll() },
  ];

  readonly paged: PagedCollectionSource<LibraryUser>;

  /** The grid renders and drives the checkbox column from this - see its
   *  [selection] input. A CDK SelectionModel rather than the module's own
   *  LibraryRowSelection util, because that is what the shared grid speaks
   *  (2026-08-21, bucket A item #1). Holds the USERS, so the messaging
   *  paths below map to `.id` (a lowercased email) themselves. */
  readonly selection = new SelectionModel<LibraryUser>(true, []);

  get selectedCount(): number {
    return this.selection.selected.length;
  }

  constructor(
    private libraryUserService: LibraryUserService,
    private dialog: MatDialog,
    private snackbar: SnackbarService,
    private router: Router,
  ) {
    this.paged = new PagedCollectionSource<LibraryUser>(
      (pageSize, cursor) => this.libraryUserService.getLibraryUsersPage(pageSize, cursor),
      50,
    );
    // The grid consumes `paged` directly ([pagedSource]) and drives its own
    // loading, infinite scroll and footer, so none of that is mirrored onto
    // fields here any more. One subscription remains: dropping selections
    // for rows that are no longer loaded, so a stale id can't be messaged.
    this.paged.rows$.subscribe((users) => {
      const liveIds = new Set(users.map((user) => user.id));
      for (const selected of this.selection.selected) {
        if (!liveIds.has(selected.id)) {
          this.selection.deselect(selected);
        }
      }
    });
    void this.paged.loadFirstPage();
  }

  userName(user: LibraryUser): string {
    return [user.firstName, user.lastName].filter(Boolean).join(' ');
  }

  /** Flag + place in one cell: the grid renders plain text per column, and
   *  splitting these into two columns would give the flag its own sortable,
   *  filterable header for no reason. */
  locationCell(user: LibraryUser): string {
    const flag = countryFlagEmoji(user.location?.countryCode);
    const label = this.locationLabel(user);
    return [flag, label].filter(Boolean).join(' ').trim();
  }

  locationLabel(user: LibraryUser): string {
    const location = user.location;
    return [location?.city, location?.region, location?.country].filter(Boolean).join(', ');
  }

  /** An international user's effective access is every book regardless of
   *  the stored array. */
  licenseLabel(user: LibraryUser): string {
    if (user.internationalUser) {
      return 'All books';
    }
    const count = user.licensedBookIds?.length ?? 0;
    return count === 1 ? '1 book' : `${count} books`;
  }

  openDetail(user: LibraryUser): void {
    void this.router.navigate(['/library-manager/library-users', user.id]);
  }

  async messageSelected(): Promise<void> {
    const emails = this.selection.selected.map((user) => user.id);
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
