import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
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
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './message-history.component.html',
  styleUrl: './message-history.component.scss',
})
export class MessageHistoryComponent {
  private readonly libraryUserService = inject(LibraryUserService);
  private readonly dialog = inject(MatDialog);

  readonly displayedColumns = ['sentAt', 'title', 'sentBy', 'recipients', 'delivered'];
  readonly messages = signal<AdminMessage[]>([]);
  readonly loading = signal(true);

  constructor() {
    this.libraryUserService.getAdminMessages().subscribe((messages) => {
      this.messages.set(messages);
      this.loading.set(false);
    });
  }

  trackByMessageId(_index: number, message: AdminMessage): string {
    return message.id;
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
