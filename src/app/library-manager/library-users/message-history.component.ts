import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { SharedModule } from 'src/app/shared/shared.module';
import { DataGridColumn } from 'src/app/shared/data-grid/data-grid.model';
import { AdminMessage } from '@impact-common/models/library-user-message.model';
import { LibraryUserService } from 'src/app/common/services/data/library/library-user.service';
import { LibraryMessageDetailDialogComponent } from '../dialogs/library-message-detail-dialog.component';

/**
 * Ported from impact-discipleship-library-manager-new's
 * message-history/message-history.component.ts. Sent-announcement history
 * - one row per sendLibraryUserMessage broadcast (the adminMessages
 * summary collection; admin-only read under firestore.rules). Read-only:
 * messages can't be edited or recalled once sent - each recipient already
 * holds their own inbox copy. Route:
 * /library-manager/library-users/messages.
 */
@Component({
  selector: 'app-message-history',
  standalone: true,
  // SharedModule for <app-data-grid> - see lesson-templates-list.
  imports: [CommonModule, SharedModule],
  templateUrl: './message-history.component.html',
  styleUrl: './message-history.component.scss',
})
export class MessageHistoryComponent {
  private readonly libraryUserService = inject(LibraryUserService);
  private readonly dialog = inject(MatDialog);

  readonly columns: DataGridColumn<AdminMessage>[] = [
    { key: 'sentAt', label: 'Sent', type: 'date', dateFormat: 'medium' },
    { key: 'title', label: 'Title' },
    { key: 'sentByName', label: 'Sent by' },
    { key: 'recipients', label: 'Recipients', value: (m) => this.scopeLabel(m) },
    // Recipients whose DEVICE notification was delivered - everyone also
    // gets the message in their reader-app inbox regardless, which is why
    // this is a ratio rather than a pass/fail.
    { key: 'delivered', label: 'Push delivered', value: (m) => this.deliveredLabel(m) },
  ];
  readonly messages = signal<AdminMessage[]>([]);
  readonly loading = signal(true);

  constructor() {
    this.libraryUserService.getAdminMessages().subscribe((messages) => {
      this.messages.set(messages);
      this.loading.set(false);
    });
  }

  deliveredLabel(message: AdminMessage): string {
    return `${message.pushSuccessCount}/${message.recipientCount}`;
  }

  scopeLabel(message: AdminMessage): string {
    return message.recipientScope === 'all'
      ? `All library users (${message.recipientCount})`
      : `${message.recipientCount} selected`;
  }

  openDetail(message: AdminMessage): void {
    this.dialog.open(LibraryMessageDetailDialogComponent, { width: '520px', data: { message } });
  }
}
