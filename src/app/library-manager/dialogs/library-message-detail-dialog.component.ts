import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { AdminMessage } from '@impact-common/models/library-user-message.model';

export interface LibraryMessageDetailDialogData {
  message: AdminMessage;
}

/** Ported near-verbatim from impact-discipleship-library-manager-new's
 *  message-history/message-detail-dialog.component.ts. Read-only view of
 *  one sent announcement (see MessageHistoryComponent) - full body plus,
 *  for 'selected' sends, the recipient list ('all' sends deliberately
 *  store no roster snapshot; see AdminMessage.recipients). */
@Component({
  selector: 'app-library-message-detail-dialog',
  standalone: true,
  imports: [DatePipe, MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.message.title }}</h2>
    <mat-dialog-content>
      <p class="meta">
        Sent {{ data.message.sentAt | date: 'medium' }} by {{ data.message.sentByName }} to
        {{
          data.message.recipientScope === 'all'
            ? 'all library users (' + data.message.recipientCount + ')'
            : data.message.recipientCount + ' selected user(s)'
        }}. Device notifications reached {{ data.message.pushSuccessCount }} of
        {{ data.message.recipientCount }}.
      </p>
      <p class="body">{{ data.message.body }}</p>
      @if (data.message.recipients?.length) {
        <h4>Recipients</h4>
        <ul class="recipients">
          @for (email of data.message.recipients; track email) {
            <li>{{ email }}</li>
          }
        </ul>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    .meta {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.85rem;
      margin: 0 0 12px;
    }
    .body {
      white-space: pre-wrap;
      margin: 0 0 12px;
    }
    h4 {
      margin: 0 0 4px;
    }
    .recipients {
      margin: 0;
      padding-left: 20px;
      max-height: 180px;
      overflow-y: auto;
    }
  `,
})
export class LibraryMessageDetailDialogComponent {
  readonly data = inject<LibraryMessageDetailDialogData>(MAT_DIALOG_DATA);
}
